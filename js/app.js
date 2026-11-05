/*
 * app.js — 画面の表示と操作
 * データの保存・読み込みは window.ExpenseStore（storage.js）経由でのみ行う。
 * 画面は「ホーム / 入力 / 履歴 / 統計」の4つ。URLの #home などで切り替える。
 */
(function () {
  'use strict';

  const store = window.ExpenseStore;
  const { CATEGORIES, colorVar, inkVar } = window.KakeiboCategories;
  const VIEWS = ['home', 'input', 'history', 'stats'];
  const subsUI = window.KakeiboSubs;

  // ---------- 要素 ----------
  const $ = (sel) => document.querySelector(sel);
  // 共通
  const tabbar = $('#tabbar');
  const monthNav = $('#month-nav');
  const monthLabel = $('#month-label');
  const thisMonthBtn = $('#this-month');
  const toastEl = $('#toast');
  // ホーム
  const heroLabel = $('#hero-label');
  const monthTotal = $('#month-total');
  const monthCount = $('#month-count');
  const heroCompare = $('#hero-compare');
  const heroDaily = $('#hero-daily');
  const heroTop = $('#hero-top');
  const breakdownCard = $('#breakdown-card');
  const stackbar = $('#stackbar');
  const breakdownList = $('#breakdown-list');
  const recentList = $('#recent-list');
  const homeEmpty = $('#home-empty');
  const upcomingCard = $('#upcoming-card');
  const upcomingList = $('#upcoming-list');
  // 入力
  const formCard = $('#form-card');
  const form = $('#expense-form');
  const formTitle = $('#form-title');
  const dateInput = $('#f-date');
  const amountInput = $('#f-amount');
  const categoryBox = $('#f-category');
  const memoInput = $('#f-memo');
  const errorMsg = $('#form-error');
  const submitBtn = $('#submit-btn');
  const cancelBtn = $('#cancel-edit');
  const tagEditor = $('#tag-editor');
  const tagListEl = $('#f-tags');
  const tagInput = $('#f-tag-input');
  const tagSuggest = $('#tag-suggest');
  // 履歴
  const listEl = $('#expense-list');
  const emptyMsg = $('#empty-msg');
  const listTools = $('#list-tools');
  const filterCategory = $('#filter-category');
  const filterText = $('#filter-text');
  const filterTag = $('#filter-tag');
  const filterFrom = $('#filter-from');
  const filterTo = $('#filter-to');
  const rangeChips = $('#range-chips');
  const customRange = $('#custom-range');
  const monthPicker = $('#month-picker');
  const filterSummary = $('#filter-summary');
  const filterClearBtn = $('#filter-clear');
  const selectModeBtn = $('#select-mode');
  const bulkBar = $('#bulk-bar');
  const selectAllBtn = $('#select-all');
  const selectedCount = $('#selected-count');
  const bulkDeleteBtn = $('#bulk-delete');
  // 統計
  const statTotal = $('#stat-total');
  const statCompare = $('#stat-compare');
  const statDaily = $('#stat-daily');
  const statsEmpty = $('#stats-empty');

  // ---------- 状態 ----------
  let expenses = [];
  let currentView = 'home';
  let inputPanel = 'expense';    // 入力画面の中の表示：'expense'（支出）か 'subs'（サブスク）
  let currentMonth = todayStr().slice(0, 7); // 'YYYY-MM'
  let editingId = null;
  let returnView = 'history';    // 編集が終わったら戻る画面
  let selectedCategory = CATEGORIES[0];
  let formTags = [];             // 入力フォームに付いているタグ
  let selectMode = false;        // 複数選択モード中か
  const selectedIds = new Set(); // 選択中の支出ID
  let visibleItems = [];         // いま履歴に表示されている支出（絞り込み後）

  // ---------- ユーティリティ ----------
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function shiftDate(dateStr, delta) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }
  // 全角数字は半角にし、数字以外（カンマ・円記号など）は取り除く
  function toDigits(s) {
    return String(s)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/\D/g, '');
  }
  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function formatDay(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
    return m + '月' + d + '日（' + w + '）';
  }
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text; // textContent なのでメモにHTMLが入っても安全
    return e;
  }
  // 要素にカテゴリの色（--c）と、その上に載せる文字色（--ink）を設定する
  function paint(node, category) {
    node.style.setProperty('--c', 'var(' + colorVar(category) + ')');
    node.style.setProperty('--ink', 'var(' + inkVar(category) + ')');
    return node;
  }
  function dot(category) {
    const d = paint(el('span', 'dot'), category);
    d.setAttribute('aria-hidden', 'true');
    return d;
  }
  function sum(list) { return list.reduce((s, e) => s + e.amount, 0); }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
  }

  // ---------- 画面の切り替え ----------
  // #subs は「入力画面のサブスク表示」として扱う
  function routeFromHash() {
    const v = location.hash.replace('#', '');
    if (v === 'subs') return { view: 'input', panel: 'subs' };
    return { view: VIEWS.includes(v) ? v : 'home', panel: 'expense' };
  }

  function showView(view, panel = 'expense') {
    if (view !== 'history' && selectMode) setSelectMode(false);
    currentView = view;
    inputPanel = panel;
    document.querySelectorAll('.view').forEach((s) => { s.hidden = s.dataset.view !== view; });
    document.querySelectorAll('#view-input .panel').forEach((p) => { p.hidden = p.dataset.panel !== panel; });
    document.querySelectorAll('#input-tabs [data-panel]').forEach((a) => {
      a.setAttribute('aria-selected', String(a.dataset.panel === panel));
    });
    tabbar.querySelectorAll('a[data-view]').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    monthNav.hidden = view === 'input'; // 入力画面では月の切り替えは使わない
    window.scrollTo(0, 0);
    render();
    if (view === 'input' && panel === 'expense' && window.matchMedia('(min-width: 960px)').matches) amountInput.focus();
  }

  function go(view) {
    if (location.hash === '#' + view) showView(view);
    else location.hash = view; // hashchange で showView が呼ばれる
  }

  window.addEventListener('hashchange', () => {
    const r = routeFromHash();
    showView(r.view, r.panel);
  });

  // ---------- 描画（全体） ----------
  function render() {
    const [y, m] = currentMonth.split('-').map(Number);
    monthLabel.textContent = y + '年' + m + '月';
    monthPicker.value = currentMonth;
    thisMonthBtn.hidden = currentMonth === todayStr().slice(0, 7);

    const items = expenses.filter((e) => e.date.startsWith(currentMonth));
    const stats = monthStats(items);

    if (currentView === 'home') renderHome(items, stats);
    if (currentView === 'history') renderHistory(items);
    if (currentView === 'stats') renderStats(items, stats);
    if (currentView === 'input' && inputPanel === 'subs') subsUI.render();
  }

  // 月の数字（合計・前月比・1日平均・いちばん多いカテゴリ）
  function monthStats(items) {
    const [y, m] = currentMonth.split('-').map(Number);
    const total = sum(items);
    const prevMonth = shiftMonth(currentMonth, -1);
    const prevTotal = sum(expenses.filter((e) => e.date.startsWith(prevMonth)));
    const lastDay = new Date(y, m, 0).getDate();
    const today = todayStr();
    let days = lastDay;
    if (today.startsWith(currentMonth)) days = Number(today.slice(8, 10)); // 今月は今日まで
    else if (currentMonth > today.slice(0, 7)) days = 0;                  // 未来の月
    const byCat = new Map();
    for (const e of items) byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
    const cats = [...byCat].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
    return { total, count: items.length, prevTotal, daily: days ? total / days : 0, cats, month: m };
  }

  function compareText(stats) {
    if (!stats.prevTotal) return null;
    const diff = stats.total - stats.prevTotal;
    if (diff === 0) return { text: '前月と同じ', cls: '' };
    // 色だけでなく ▲▼ の記号でも増減がわかるように
    return diff > 0
      ? { text: '▲ 前月より ' + yen(diff) + ' 多い', short: '▲ ' + yen(diff), cls: 'up' }
      : { text: '▼ 前月より ' + yen(-diff) + ' 少ない', short: '▼ ' + yen(-diff), cls: 'down' };
  }

  // ---------- ホーム ----------
  function renderHome(items, stats) {
    renderUpcoming();
    heroLabel.textContent = stats.month + '月の支出';
    monthTotal.textContent = yen(stats.total);
    monthCount.textContent = stats.count + '件';
    const cmp = compareText(stats);
    heroCompare.textContent = cmp ? cmp.text : '';
    heroCompare.className = 'delta ' + (cmp ? cmp.cls : '');
    heroDaily.textContent = yen(stats.daily);
    heroTop.textContent = stats.cats[0] ? stats.cats[0].category + ' ' + yen(stats.cats[0].amount) : '—';

    // カテゴリ内訳：帯グラフ（色のないカテゴリは1つにまとめる）と一覧
    breakdownCard.hidden = items.length === 0;
    const segments = [];
    let grayAmount = 0;
    for (const c of stats.cats) {
      if (colorVar(c.category) === '--cat-other') grayAmount += c.amount;
      else segments.push(c);
    }
    stackbar.replaceChildren(
      ...segments.map((c) => {
        const s = paint(el('span'), c.category);
        s.style.background = 'var(--c)';
        s.style.flexGrow = String(c.amount);
        s.title = c.category + ' ' + yen(c.amount);
        return s;
      }),
      ...(grayAmount ? [Object.assign(el('span'), { title: 'その他 ' + yen(grayAmount) })] : [])
    );
    if (grayAmount) {
      const g = stackbar.lastChild;
      g.style.background = 'var(--cat-other)';
      g.style.flexGrow = String(grayAmount);
    }
    stackbar.setAttribute('aria-label', 'カテゴリ内訳：' + stats.cats.map((c) => c.category + ' ' + yen(c.amount)).join('、'));

    breakdownList.replaceChildren(
      ...stats.cats.map((c) => {
        const li = el('li');
        const pct = stats.total ? Math.round((c.amount / stats.total) * 100) + '%' : '0%';
        li.append(dot(c.category), el('span', '', c.category), el('span', 'amt', yen(c.amount)), el('span', 'pct', pct));
        return li;
      })
    );

    // 最近の支出（この月の新しい順に5件）
    homeEmpty.hidden = items.length > 0;
    recentList.hidden = items.length === 0;
    recentList.replaceChildren(
      ...items.slice(0, 5).map((e) => {
        const li = el('li');
        const b = el('button', 'recent-item');
        b.type = 'button';
        b.dataset.id = e.id;
        b.title = 'タップして編集';
        const icon = paint(el('span', 'cat-icon', e.category.slice(0, 1)), e.category);
        icon.setAttribute('aria-hidden', 'true');
        const body = el('span', 'r-body');
        const sub = [formatDay(e.date), e.category, ...e.tags.map((t) => '#' + t)].join('・');
        body.append(el('span', 'r-title', e.memo || e.category), el('span', 'r-sub', sub));
        b.append(icon, body, el('span', 'r-amount', yen(e.amount)));
        li.append(b);
        return li;
      })
    );
  }

  // 近日のサブスク支払い（7日以内）
  function renderUpcoming() {
    const today = todayStr();
    const list = subsUI.upcoming(7);
    upcomingCard.hidden = list.length === 0;
    upcomingList.replaceChildren(
      ...list.map(({ sub, date }) => {
        const li = el('li');
        const icon = paint(el('span', 'cat-icon', sub.category.slice(0, 1)), sub.category);
        icon.setAttribute('aria-hidden', 'true');
        const body = el('span', 'r-body');
        const days = Math.round((new Date(date) - new Date(today)) / 86400000);
        body.append(el('span', 'u-name', sub.name), el('span', 'u-when', formatDay(date) + '・' + (days === 0 ? '今日' : 'あと' + days + '日')));
        li.append(icon, body, el('span', 'u-amt', yen(sub.amount)));
        return li;
      })
    );
  }

  recentList.addEventListener('click', (e) => {
    const b = e.target.closest('.recent-item');
    if (b) startEdit(b.dataset.id);
  });

  // ---------- 統計 ----------
  function renderStats(items, stats) {
    statTotal.textContent = yen(stats.total);
    const cmp = compareText(stats);
    statCompare.textContent = cmp ? cmp.short || cmp.text : '—';
    statCompare.className = cmp ? 'delta ' + cmp.cls : '';
    statDaily.textContent = yen(stats.daily);
    statsEmpty.hidden = expenses.length > 0;
    window.KakeiboCharts.render(expenses, items, currentMonth);
  }

  // ---------- カテゴリ選択（チップ） ----------
  function renderCategoryChips() {
    categoryBox.replaceChildren(
      ...CATEGORIES.map((c) => {
        const b = paint(el('button', 'chip'), c);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(c === selectedCategory));
        b.dataset.category = c;
        b.append(dot(c), document.createTextNode(c));
        return b;
      })
    );
  }
  function selectCategory(c) {
    selectedCategory = c;
    categoryBox.querySelectorAll('.chip').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.category === c));
    });
  }
  categoryBox.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) selectCategory(chip.dataset.category);
  });

  // ---------- タグ入力 ----------
  // 使われた回数の多い順に並べたタグ一覧
  function allTagsByUse() {
    const counts = new Map();
    for (const e of expenses) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }

  function renderFormTags() {
    tagListEl.replaceChildren(
      ...formTags.map((t) => {
        const chip = el('span', 'tag', '#' + t);
        const x = el('button', 'tag-remove', '×');
        x.type = 'button';
        x.dataset.tag = t;
        x.setAttribute('aria-label', t + 'を外す');
        chip.append(x);
        return chip;
      })
    );
    // よく使うタグの候補（付いていないものを最大8個）
    tagSuggest.replaceChildren(
      ...allTagsByUse()
        .filter((t) => !formTags.includes(t))
        .slice(0, 8)
        .map((t) => {
          const b = el('button', '', '+ ' + t);
          b.type = 'button';
          b.dataset.tag = t;
          return b;
        })
    );
  }

  function addTags(raw) {
    formTags = store.normalizeTags([...formTags, ...String(raw).split(/[,、\s]+/)]);
    renderFormTags();
  }

  tagEditor.addEventListener('click', (e) => {
    const x = e.target.closest('.tag-remove');
    if (x) {
      formTags = formTags.filter((t) => t !== x.dataset.tag);
      renderFormTags();
    }
    tagInput.focus();
  });
  tagSuggest.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tag]');
    if (b) addTags(b.dataset.tag);
  });
  tagInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 日本語変換中のEnterは無視
    if (e.key === 'Enter' && tagInput.value.trim()) {
      e.preventDefault(); // フォームを送信せず、タグとして追加
      addTags(tagInput.value);
      tagInput.value = '';
    } else if (e.key === 'Backspace' && !tagInput.value && formTags.length) {
      formTags = formTags.slice(0, -1); // 空欄でBackspace → 最後のタグを外す
      renderFormTags();
    }
  });
  tagInput.addEventListener('input', (e) => {
    if (e.isComposing) return;
    // 「,」「、」スペースを打ったら、その前までをタグにする
    if (/[,、\s]/.test(tagInput.value)) {
      const parts = tagInput.value.split(/[,、\s]/);
      const rest = parts.pop();
      addTags(parts.join(','));
      tagInput.value = rest;
    }
  });

  // ---------- 入力フォーム ----------
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = !msg;
  }

  function resetForm() {
    editingId = null;
    form.reset();
    dateInput.value = todayStr();
    selectCategory(CATEGORIES[0]);
    formTags = [];
    tagInput.value = '';
    renderFormTags();
    formTitle.textContent = '支出を入力';
    submitBtn.textContent = '追加する';
    cancelBtn.hidden = true;
    formCard.classList.remove('editing');
    showError('');
  }

  function startEdit(id) {
    const e = expenses.find((x) => x.id === id);
    if (!e) return;
    returnView = currentView === 'input' ? 'history' : currentView;
    editingId = id;
    dateInput.value = e.date;
    amountInput.value = e.amount;
    memoInput.value = e.memo;
    selectCategory(CATEGORIES.includes(e.category) ? e.category : 'その他');
    formTags = [...e.tags];
    tagInput.value = '';
    renderFormTags();
    formTitle.textContent = '支出を編集';
    submitBtn.textContent = '更新する';
    cancelBtn.hidden = false;
    formCard.classList.add('editing');
    showError('');
    go('input');
  }

  // 金額欄：数字以外は入らないようにする
  amountInput.addEventListener('input', () => {
    const digits = toDigits(amountInput.value);
    if (digits !== amountInput.value) amountInput.value = digits;
  });

  // 日付の前日・翌日ボタン
  function stepDate(delta) {
    dateInput.value = shiftDate(dateInput.value || todayStr(), delta);
  }
  $('#date-prev').addEventListener('click', () => stepDate(-1));
  $('#date-next').addEventListener('click', () => stepDate(1));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // タグ欄に打ちかけの文字があれば、それもタグとして付ける
    if (tagInput.value.trim()) {
      addTags(tagInput.value);
      tagInput.value = '';
    }
    const data = {
      date: dateInput.value,
      amount: toDigits(amountInput.value),
      category: selectedCategory,
      memo: memoInput.value,
      tags: formTags,
    };
    if (!data.amount) { showError('金額を入力してください'); amountInput.focus(); return; }

    submitBtn.disabled = true;
    try {
      const wasEditing = Boolean(editingId);
      if (wasEditing) await store.update(editingId, data);
      else await store.add(data);
      currentMonth = data.date.slice(0, 7); // 入力した月を表示
      resetForm();
      await refresh();
      if (wasEditing) {
        toast('更新しました');
        go(returnView);
      } else {
        // 続けて入力しやすいよう、日付はそのまま残して金額欄へ
        dateInput.value = data.date;
        toast('追加しました：' + data.category + ' ' + yen(Number(data.amount)));
        amountInput.focus();
      }
    } catch (err) {
      showError(err.message || '保存に失敗しました');
    } finally {
      submitBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener('click', () => {
    resetForm();
    go(returnView);
  });

  // ---------- 履歴 ----------
  function renderHistory(items) {
    const [y, m] = currentMonth.split('-').map(Number);
    const cat = filterCategory.value;
    const keyword = filterText.value.trim().toLowerCase();

    // 期間（表示中の月の中で選ぶ）
    const { from, to } = currentRange();
    renderRangeChips();

    // タグの選択肢は、この月に使われているタグ（＋いま選んでいるタグ）
    const tag = filterTag.value;
    const monthTags = [...new Set(items.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b, 'ja'));
    if (tag && !monthTags.includes(tag)) monthTags.unshift(tag);
    filterTag.replaceChildren(
      el('option', '', 'すべてのタグ'),
      ...monthTags.map((t) => {
        const o = el('option', '', '#' + t);
        o.value = t;
        return o;
      })
    );
    filterTag.firstChild.value = '';
    filterTag.value = tag;
    filterTag.disabled = monthTags.length === 0;

    const filtering = Boolean(cat || tag || keyword || from || to);
    visibleItems = items.filter(
      (e) =>
        (!cat || e.category === cat) &&
        (!tag || e.tags.includes(tag)) &&
        (!keyword || e.memo.toLowerCase().includes(keyword) || e.tags.some((t) => t.toLowerCase().includes(keyword))) &&
        (!from || e.date >= from) &&
        (!to || e.date <= to)
    );

    listTools.hidden = items.length === 0;
    filterClearBtn.hidden = !filtering;
    filterSummary.textContent = filtering
      ? '絞り込み：' + visibleItems.length + '件 ' + yen(sum(visibleItems))
      : items.length + '件 ' + yen(sum(items));

    emptyMsg.hidden = visibleItems.length > 0;
    emptyMsg.textContent = items.length === 0 ? 'この月の支出はまだありません' : '条件に合う支出はありません';

    // 見えなくなった支出は選択から外す（見えないものを消してしまわないように）
    const visibleIds = new Set(visibleItems.map((e) => e.id));
    for (const id of [...selectedIds]) if (!visibleIds.has(id)) selectedIds.delete(id);
    if (selectMode && visibleItems.length === 0) selectMode = false;
    updateSelectionUI();

    // 日付ごとにまとめる（expenses は新しい順に並んでいる）
    const groups = new Map();
    for (const e of visibleItems) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    }

    const frag = document.createDocumentFragment();
    for (const [date, list] of groups) {
      const group = el('div', 'day-group');
      const head = el('div', 'day-head');
      head.append(el('span', '', formatDay(date)), el('span', '', yen(sum(list))));
      const ul = el('ul', 'day-items');
      for (const e of list) {
        const li = paint(el('li', 'item'), e.category);
        li.dataset.id = e.id;
        const isSelected = selectedIds.has(e.id);
        li.classList.toggle('selected', isSelected);
        const check = el('input', 'item-check');
        check.type = 'checkbox';
        check.checked = isSelected;
        check.tabIndex = selectMode ? 0 : -1;
        check.setAttribute('aria-label', formatDay(e.date) + ' ' + e.category + ' ' + yen(e.amount) + 'を選択');
        const badge = paint(el('span', 'badge'), e.category);
        badge.append(dot(e.category), document.createTextNode(e.category));
        const main = el('div', 'item-main');
        main.append(check, badge, el('span', e.memo ? 'memo' : 'memo none', e.memo || 'メモなし'));
        li.append(main, el('span', 'amount', yen(e.amount)));
        if (e.tags.length) {
          const tagsEl = el('div', 'item-tags');
          for (const t of e.tags) {
            const tb = el('button', 'item-tag' + (t === tag ? ' active' : ''), '#' + t);
            tb.type = 'button';
            tb.dataset.action = 'tag';
            tb.dataset.tag = t;
            tb.title = '#' + t + ' で絞り込む';
            tagsEl.append(tb);
          }
          li.append(tagsEl);
        }
        const actions = el('div', 'item-actions');
        const editBtn = el('button', 'edit', '編集');
        editBtn.type = 'button';
        editBtn.dataset.action = 'edit';
        const delBtn = el('button', 'del', '削除');
        delBtn.type = 'button';
        delBtn.dataset.action = 'delete';
        actions.append(editBtn, delBtn);
        li.append(actions);
        ul.append(li);
      }
      group.append(head, ul);
      frag.append(group);
    }
    listEl.replaceChildren(frag);
  }

  // 絞り込み
  filterCategory.append(
    ...CATEGORIES.map((c) => {
      const o = el('option', '', c);
      o.value = c;
      return o;
    })
  );
  filterCategory.addEventListener('change', render);
  filterText.addEventListener('input', render);
  filterTag.addEventListener('change', render);
  filterFrom.addEventListener('change', render);
  filterTo.addEventListener('change', render);

  // ---------- 期間のプリセット ----------
  // 表示中の月の中で、よく使う範囲をワンタップで選べるようにする。
  // 「今日」「直近7日」は今月を表示しているときだけ出す。
  let rangePreset = 'all';

  function monthBounds() {
    const [y, m] = currentMonth.split('-').map(Number);
    return { start: currentMonth + '-01', end: currentMonth + '-' + pad(new Date(y, m, 0).getDate()) };
  }

  function rangePresets() {
    const { start, end } = monthBounds();
    const today = todayStr();
    const isThisMonth = today.startsWith(currentMonth);
    const list = [{ id: 'all', label: 'この月すべて' }];
    if (isThisMonth) {
      list.push({ id: 'today', label: '今日', from: today, to: today });
      const weekAgo = shiftDate(today, -6);
      list.push({ id: 'week', label: '直近7日', from: weekAgo < start ? start : weekAgo, to: today });
    }
    list.push(
      { id: 'early', label: '上旬', sub: '1〜10日', from: currentMonth + '-01', to: currentMonth + '-10' },
      { id: 'mid', label: '中旬', sub: '11〜20日', from: currentMonth + '-11', to: currentMonth + '-20' },
      { id: 'late', label: '下旬', sub: '21日〜', from: currentMonth + '-21', to: end },
      { id: 'custom', label: '日付を指定' }
    );
    return list;
  }

  function currentRange() {
    const presets = rangePresets();
    // 月を切り替えて使えなくなったプリセット（例：先月を見ているのに「今日」）は解除
    if (!presets.some((p) => p.id === rangePreset)) rangePreset = 'all';

    const { start, end } = monthBounds();
    for (const input of [filterFrom, filterTo]) {
      input.min = start;
      input.max = end;
      if (input.value && !input.value.startsWith(currentMonth)) input.value = '';
      input.classList.toggle('empty', !input.value);
    }
    customRange.hidden = rangePreset !== 'custom';

    if (rangePreset === 'custom') {
      let from = filterFrom.value;
      let to = filterTo.value;
      if (from && to && from > to) [from, to] = [to, from]; // 開始と終了が逆なら入れ替えて扱う
      return { from, to };
    }
    const p = presets.find((x) => x.id === rangePreset);
    return { from: p.from || '', to: p.to || '' };
  }

  function renderRangeChips() {
    rangeChips.replaceChildren(
      ...rangePresets().map((p) => {
        const b = el('button', '', p.label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(p.id === rangePreset));
        b.dataset.preset = p.id;
        if (p.sub) b.append(el('small', '', p.sub));
        return b;
      })
    );
  }

  rangeChips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-preset]');
    if (!b) return;
    // 選んでいるものをもう一度押したら解除（「この月すべて」に戻す）
    rangePreset = rangePreset === b.dataset.preset && b.dataset.preset !== 'all' ? 'all' : b.dataset.preset;
    render();
    if (rangePreset === 'custom' && !filterFrom.value) filterFrom.focus();
  });
  filterClearBtn.addEventListener('click', () => {
    filterCategory.value = '';
    filterTag.value = '';
    filterText.value = '';
    filterFrom.value = '';
    filterTo.value = '';
    rangePreset = 'all';
    render();
  });

  // 複数選択・一括削除
  function updateSelectionUI() {
    listEl.classList.toggle('selecting', selectMode);
    bulkBar.hidden = !selectMode;
    document.body.classList.toggle('has-bulk-bar', selectMode);
    selectModeBtn.textContent = selectMode ? '選択をやめる' : '選択';
    selectedCount.textContent = selectedIds.size + '件選択';
    bulkDeleteBtn.disabled = selectedIds.size === 0;
    const allSelected = visibleItems.length > 0 && selectedIds.size === visibleItems.length;
    selectAllBtn.textContent = allSelected ? '選択を解除' : 'すべて選択';
  }

  function setSelectMode(on) {
    selectMode = on;
    selectedIds.clear();
    updateSelectionUI();
    render();
  }

  function toggleSelected(li) {
    const id = li.dataset.id;
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    li.classList.toggle('selected', selectedIds.has(id));
    li.querySelector('.item-check').checked = selectedIds.has(id);
    updateSelectionUI();
  }

  selectModeBtn.addEventListener('click', () => setSelectMode(!selectMode));
  $('#select-done').addEventListener('click', () => setSelectMode(false));

  selectAllBtn.addEventListener('click', () => {
    const allSelected = selectedIds.size === visibleItems.length;
    selectedIds.clear();
    if (!allSelected) visibleItems.forEach((e) => selectedIds.add(e.id));
    render();
  });

  bulkDeleteBtn.addEventListener('click', async () => {
    const targets = visibleItems.filter((e) => selectedIds.has(e.id));
    if (targets.length === 0) return;
    if (!confirm(targets.length + '件（合計 ' + yen(sum(targets)) + '）を削除しますか？\nこの操作は取り消せません。')) return;
    await store.removeMany(targets.map((e) => e.id));
    if (editingId && selectedIds.has(editingId)) resetForm();
    selectMode = false;
    selectedIds.clear();
    await refresh();
    toast(targets.length + '件を削除しました');
  });

  // 一覧のボタン（タグ・編集・削除）
  listEl.addEventListener('click', async (ev) => {
    if (selectMode) {
      const li = ev.target.closest('.item');
      if (!li) return;
      // チェックボックス自体のクリックは checked が先に変わるので、ここで状態をそろえる
      if (ev.target.classList.contains('item-check')) ev.target.checked = !ev.target.checked;
      toggleSelected(li);
      return;
    }
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.closest('.item').dataset.id;

    if (btn.dataset.action === 'tag') {
      // 一覧のタグをタップ → そのタグで絞り込む（もう一度タップで解除）
      filterTag.value = filterTag.value === btn.dataset.tag ? '' : btn.dataset.tag;
      render();
      if (filterTag.value) listTools.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (btn.dataset.action === 'edit') {
      startEdit(id);
    } else if (btn.dataset.action === 'delete') {
      const e = expenses.find((x) => x.id === id);
      if (!e) return;
      const label = formatDay(e.date) + ' ' + e.category + ' ' + yen(e.amount);
      if (!confirm('この支出を削除しますか？\n' + label)) return;
      await store.remove(id);
      if (editingId === id) resetForm();
      await refresh();
      toast('削除しました');
    }
  });

  // ---------- 月の切り替え ----------
  $('#prev-month').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, -1); render(); });
  $('#next-month').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, 1); render(); });
  thisMonthBtn.addEventListener('click', () => { currentMonth = todayStr().slice(0, 7); render(); });

  // 月の表示をタップ → 月を選ぶ画面を開く（type="month" と showPicker に対応したブラウザのみ）
  const canPickMonth = monthPicker.type === 'month' && typeof monthPicker.showPicker === 'function';
  monthPicker.closest('.month-label-wrap').classList.toggle('no-picker', !canPickMonth);
  monthPicker.closest('.month-label-wrap').addEventListener('click', (e) => {
    e.preventDefault();
    if (!canPickMonth) return;
    try { monthPicker.showPicker(); } catch (err) { /* 開けない環境では何もしない */ }
  });
  monthPicker.addEventListener('change', () => {
    if (/^\d{4}-\d{2}$/.test(monthPicker.value)) {
      currentMonth = monthPicker.value;
      render();
    }
  });

  // ---------- 起動 ----------
  async function refresh() {
    expenses = await store.list();
    render();
    renderFormTags(); // よく使うタグの候補を最新にする
  }

  // サブスクの画面に、このファイルの道具を渡す
  subsUI.init({
    yen, el, paint, formatDay, todayStr, shiftDate, toDigits, toast,
    onChange: async () => {
      await subsUI.load();
      await refresh();
    },
  });

  // 支払日を迎えたサブスクを支出に記録する
  async function recordDueSubscriptions() {
    const n = await subsUI.runDue();
    if (n) {
      await refresh();
      toast('サブスク ' + n + '件を支出に記録しました');
    }
  }

  // 開いたままの日付が変わったときのため、画面に戻ってきたときにも確認する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recordDueSubscriptions();
  });

  // 廃止したカテゴリのデータを一度だけ消す（終わったら記録して、次からは何もしない）
  // 新しく廃止するときは、ここに { id, category } を1行足す
  const RETIRED_CATEGORIES = [{ id: 'remove-housing-2026-11', category: '住居' }];
  const MIGRATIONS_KEY = 'kakeibo.migrations';
  async function removeRetiredCategories() {
    let done = [];
    try { done = JSON.parse(localStorage.getItem(MIGRATIONS_KEY) || '[]'); } catch (e) { done = []; }
    for (const { id, category } of RETIRED_CATEGORIES) {
      if (done.includes(id)) continue;
      await store.removeByCategory(category);
      await window.SubscriptionStore.removeByCategory(category);
      done.push(id);
    }
    try { localStorage.setItem(MIGRATIONS_KEY, JSON.stringify(done)); } catch (e) { /* 次回また試すだけ */ }
  }

  renderCategoryChips();
  resetForm();
  (async () => {
    await removeRetiredCategories();
    await subsUI.load();
    await refresh();
    await recordDueSubscriptions();
    const r = routeFromHash();
    showView(r.view, r.panel);
  })();
})();
