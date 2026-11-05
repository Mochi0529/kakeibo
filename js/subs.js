/*
 * subs.js — サブスク（定期的な支払い）の管理と、支出への自動記録
 *
 * ■ 自動記録のしくみ
 *   アプリを開いたとき（と、画面に戻ってきたとき）に runDue() が動き、
 *   「支払日が今日以前で、まだ記録していない回」を支出として追加する。
 *   どこまで記録したかはサブスクの generatedUntil に残すので、同じ回が二重に記録されることはなく、
 *   自動で記録された支出をあとで削除しても、もう一度作られることはない。
 *   記録した支出には「サブスク」タグと subscriptionId が付く。
 *
 * ■ 支払日の決め方
 *   最初の支払日（startDate）を基準に、毎月なら同じ日、毎年なら同じ月日。
 *   31日のように月によって無い日は、その月の末日にする（2月なら28日か29日）。
 */
(function () {
  'use strict';

  const subStore = window.SubscriptionStore;
  const expenseStore = window.ExpenseStore;
  const { CATEGORIES } = window.KakeiboCategories;
  const SUB_TAG = 'サブスク';
  const MAX_CATCH_UP = 120; // 一度に記録する回数の上限（日付を大きく間違えたときの安全装置）

  let subs = [];
  let editingId = null;
  let h = null; // app.js から受け取る道具（yen, el, paint など）

  // ---------- 日付の計算 ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function lastDayOf(y, m) { return new Date(y, m, 0).getDate(); }

  // n 回目（0始まり）の支払日
  function occurrence(sub, n) {
    const [y, m, d] = sub.startDate.split('-').map(Number);
    if (sub.cycle === 'yearly') {
      const yy = y + n;
      return ymd(yy, m, Math.min(d, lastDayOf(yy, m)));
    }
    const t = new Date(y, m - 1 + n, 1);
    const yy = t.getFullYear();
    const mm = t.getMonth() + 1;
    return ymd(yy, mm, Math.min(d, lastDayOf(yy, mm)));
  }

  // まだ記録していない、今日以前の支払日の一覧
  function dueDates(sub, today) {
    const dates = [];
    for (let n = 0; n < 2400 && dates.length < MAX_CATCH_UP; n++) {
      const date = occurrence(sub, n);
      if (date > today) break;
      if (!sub.generatedUntil || date > sub.generatedUntil) dates.push(date);
    }
    return dates;
  }

  // 次の支払日（今日より後、または今日でまだ記録していない回）
  function nextDate(sub, today) {
    for (let n = 0; n < 2400; n++) {
      const date = occurrence(sub, n);
      if (date >= today && (!sub.generatedUntil || date > sub.generatedUntil)) return date;
    }
    return null;
  }

  function daysBetween(from, to) {
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
  }

  function monthlyAmount(sub) {
    return sub.cycle === 'yearly' ? sub.amount / 12 : sub.amount;
  }

  // ---------- 自動記録 ----------
  // 記録した件数を返す。同時に2回動いて二重に記録しないよう、実行中なら同じ結果を待つ
  let running = null;
  function runDue() {
    if (!running) running = runDueOnce().finally(() => { running = null; });
    return running;
  }
  async function runDueOnce() {
    subs = await subStore.list();
    const today = h.todayStr();
    let count = 0;
    for (const sub of subs) {
      if (!sub.active) continue;
      const dates = dueDates(sub, today);
      if (dates.length === 0) continue;
      for (const date of dates) {
        await expenseStore.add({
          date,
          amount: sub.amount,
          category: sub.category,
          memo: sub.name,
          tags: [SUB_TAG],
          subscriptionId: sub.id,
        });
        count++;
      }
      await subStore.update(sub.id, { generatedUntil: dates[dates.length - 1] });
    }
    if (count) subs = await subStore.list();
    return count;
  }

  // ホーム用：近いうちの支払い（今日から days 日以内）
  function upcoming(days) {
    const today = h.todayStr();
    return subs
      .filter((s) => s.active)
      .map((s) => ({ sub: s, date: nextDate(s, today) }))
      .filter((x) => x.date && daysBetween(today, x.date) <= days)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // ---------- 画面 ----------
  const $ = (sel) => document.querySelector(sel);
  const els = {};

  function init(helpers) {
    h = helpers;
    Object.assign(els, {
      monthly: $('#sub-monthly'),
      yearly: $('#sub-yearly'),
      count: $('#sub-count'),
      addBtn: $('#sub-add-btn'),
      formCard: $('#sub-form-card'),
      formTitle: $('#sub-form-title'),
      form: $('#sub-form'),
      name: $('#s-name'),
      amount: $('#s-amount'),
      category: $('#s-category'),
      cycle: $('#s-cycle'),
      start: $('#s-start'),
      hint: $('#s-hint'),
      error: $('#s-error'),
      submit: $('#s-submit'),
      cancel: $('#s-cancel'),
      list: $('#sub-list'),
      empty: $('#sub-empty'),
    });

    els.category.append(
      ...CATEGORIES.map((c) => {
        const o = h.el('option', '', c);
        o.value = c;
        return o;
      })
    );
    els.category.value = '娯楽';

    els.addBtn.addEventListener('click', () => openForm(null));
    els.cancel.addEventListener('click', closeForm);
    els.amount.addEventListener('input', () => {
      const digits = h.toDigits(els.amount.value);
      if (digits !== els.amount.value) els.amount.value = digits;
    });
    els.start.addEventListener('change', updateHint);
    els.cycle.addEventListener('change', updateHint);
    els.form.addEventListener('submit', onSubmit);
    els.list.addEventListener('click', onListClick);
  }

  async function load() {
    subs = await subStore.list();
  }

  function render() {
    const active = subs.filter((s) => s.active);
    const monthly = active.reduce((s, x) => s + monthlyAmount(x), 0);
    els.monthly.textContent = h.yen(monthly);
    els.yearly.textContent = h.yen(monthly * 12);
    els.count.textContent = active.length + '件' + (subs.length > active.length ? '（停止中 ' + (subs.length - active.length) + '）' : '');
    els.empty.hidden = subs.length > 0;

    const today = h.todayStr();
    // 有効なものを次の支払日が近い順に、そのあとに停止中
    const sorted = subs
      .map((s) => ({ sub: s, next: s.active ? nextDate(s, today) : null }))
      .sort((a, b) => {
        if (a.sub.active !== b.sub.active) return a.sub.active ? -1 : 1;
        return (a.next || '') < (b.next || '') ? -1 : 1;
      });

    els.list.replaceChildren(
      ...sorted.map(({ sub, next }) => {
        const li = h.paint(h.el('li', 'sub-item' + (sub.active ? '' : ' paused')), sub.category);
        li.dataset.id = sub.id;

        const icon = h.paint(h.el('span', 'cat-icon', sub.category.slice(0, 1)), sub.category);
        icon.setAttribute('aria-hidden', 'true');

        const body = h.el('div', 'sub-body');
        const title = h.el('div', 'sub-name', sub.name);
        if (!sub.active) title.append(h.el('span', 'pill', '停止中'));
        let when;
        if (!sub.active) when = '一時停止中（支出は記録されません）';
        else if (next) {
          const d = daysBetween(today, next);
          const year = next.slice(0, 4) !== today.slice(0, 4) ? next.slice(0, 4) + '年' : ''; // 来年以降なら年も出す
          when = '次回 ' + year + h.formatDay(next) + '（' + (d === 0 ? '今日' : 'あと' + d + '日') + '）';
        } else when = '—';
        body.append(title, h.el('div', 'sub-sub', when + '・' + sub.category));

        const price = h.el('div', 'sub-price');
        price.append(h.el('strong', '', h.yen(sub.amount)), h.el('span', '', sub.cycle === 'yearly' ? '/年' : '/月'));

        const actions = h.el('div', 'sub-actions');
        for (const [action, label, cls] of [
          ['toggle', sub.active ? '一時停止' : '再開', ''],
          ['edit', '編集', ''],
          ['delete', '削除', 'del'],
        ]) {
          const b = h.el('button', cls, label);
          b.type = 'button';
          b.dataset.action = action;
          actions.append(b);
        }

        li.append(icon, body, price, actions);
        return li;
      })
    );
  }

  function updateHint() {
    const today = h.todayStr();
    const start = els.start.value;
    if (!start) { els.hint.textContent = ''; return; }
    if (editingId) {
      els.hint.textContent = 'すでに記録済みの回はそのままです。変更はこれからの支払いに反映されます。';
      return;
    }
    const tmp = { startDate: start, cycle: els.cycle.value, generatedUntil: '' };
    const past = dueDates(tmp, today).length;
    els.hint.textContent = past
      ? '今日までの ' + past + '回分が、登録したときに支出として記録されます。'
      : '支払日になると、アプリを開いたときに自動で支出に記録されます。';
  }

  function openForm(sub) {
    editingId = sub ? sub.id : null;
    els.formTitle.textContent = sub ? 'サブスクを編集' : 'サブスクを追加';
    els.submit.textContent = sub ? '更新する' : '登録する';
    els.name.value = sub ? sub.name : '';
    els.amount.value = sub ? sub.amount : '';
    els.category.value = sub ? sub.category : '娯楽';
    els.cycle.value = sub ? sub.cycle : 'monthly';
    els.start.value = sub ? sub.startDate : h.todayStr();
    els.error.hidden = true;
    els.formCard.hidden = false;
    els.addBtn.hidden = true;
    updateHint();
    els.formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    els.name.focus({ preventScroll: true });
  }

  function closeForm() {
    editingId = null;
    els.formCard.hidden = true;
    els.addBtn.hidden = false;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const data = {
      name: els.name.value,
      amount: h.toDigits(els.amount.value),
      category: els.category.value,
      cycle: els.cycle.value,
      startDate: els.start.value,
    };
    els.submit.disabled = true;
    try {
      if (editingId) await subStore.update(editingId, data);
      else await subStore.add({ ...data, active: true, generatedUntil: '' });
      const wasEditing = Boolean(editingId);
      closeForm();
      const recorded = await runDue();
      await h.onChange();
      h.toast((wasEditing ? '更新しました' : '登録しました') + (recorded ? '（' + recorded + '件を支出に記録）' : ''));
    } catch (err) {
      els.error.textContent = err.message || '保存に失敗しました';
      els.error.hidden = false;
    } finally {
      els.submit.disabled = false;
    }
  }

  async function onListClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const sub = subs.find((s) => s.id === btn.closest('.sub-item').dataset.id);
    if (!sub) return;

    if (btn.dataset.action === 'edit') {
      openForm(sub);
    } else if (btn.dataset.action === 'toggle') {
      const changes = { active: !sub.active };
      // 再開するときは、止めていた間の分をさかのぼって記録しない
      if (!sub.active) {
        const yesterday = h.shiftDate(h.todayStr(), -1);
        if (!sub.generatedUntil || sub.generatedUntil < yesterday) changes.generatedUntil = yesterday;
      }
      await subStore.update(sub.id, changes);
      const recorded = await runDue();
      await h.onChange();
      h.toast(sub.active ? '一時停止しました' : '再開しました' + (recorded ? '（' + recorded + '件を支出に記録）' : ''));
    } else if (btn.dataset.action === 'delete') {
      if (!confirm('「' + sub.name + '」を削除しますか？\nこれまでに記録された支出は残ります。')) return;
      await subStore.remove(sub.id);
      if (editingId === sub.id) closeForm();
      await h.onChange();
      h.toast('削除しました');
    }
  }

  window.KakeiboSubs = { init, load, render, runDue, upcoming, SUB_TAG };
})();
