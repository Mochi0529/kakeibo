/*
 * charts.js — グラフの表示（種類の切り替え付き）
 *
 * app.js からは KakeiboCharts.render(全支出, 表示中の月の支出, 'YYYY-MM') を呼ぶだけ。
 * グラフの種類を増やすときは BUILDERS に1つ追加し、index.html にタブを1つ足す。
 *
 * 色の方針：カテゴリ別はカテゴリの色（categories.js）で塗る。ほかは基本1色（テーマの緑）で、
 * 「タグなし」や「表示中以外の月」だけ薄い色にして区別する。
 */
(function () {
  'use strict';

  const TYPE_KEY = 'kakeibo.chartType'; // 最後に選んだグラフの種類（この端末だけの設定）
  const MONTHS_IN_TREND = 6;            // 月別推移で表示する月数

  const $ = (sel) => document.querySelector(sel);
  const card = $('#chart-card');
  const tabs = $('#chart-tabs');
  const note = $('#chart-note');
  const wrap = $('#chart-wrap');
  const canvas = $('#chart-canvas');
  const emptyEl = $('#chart-empty');
  const table = $('#chart-table');
  const thead = $('#chart-thead');
  const tbody = $('#chart-tbody');

  let chart = null;
  let chartKey = '';
  let lastArgs = null;
  let type = loadType();

  // ---------- 小さな道具 ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function percent(amount, total) { return total ? Math.round((amount / total) * 1000) / 10 + '%' : '0%'; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function monthParts(ym) { return ym.split('-').map(Number); }
  function shiftMonth(ym, delta) {
    const [y, m] = monthParts(ym);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function sumBy(items, keysOf) {
    const sums = new Map();
    for (const e of items) for (const k of keysOf(e)) sums.set(k, (sums.get(k) || 0) + e.amount);
    return [...sums].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  }

  function loadType() {
    try { return localStorage.getItem(TYPE_KEY) || 'category'; } catch (e) { return 'category'; }
  }
  function saveType(t) {
    try { localStorage.setItem(TYPE_KEY, t); } catch (e) { /* 保存できなくても動作には影響しない */ }
  }

  // ---------- グラフの種類ごとの中身 ----------
  // 各関数は { orientation, rows:[{label, amount, muted?, title?}], table, note, empty } を返す
  const BUILDERS = {
    // カテゴリ別：金額の大きい順の横棒
    category(all, monthItems) {
      if (monthItems.length === 0) return { empty: 'この月の支出はまだありません' };
      const total = monthItems.reduce((s, e) => s + e.amount, 0);
      const colorVar = window.KakeiboCategories.colorVar;
      // カテゴリ別だけは、ホームや履歴と同じカテゴリの色で塗る（名前は軸と表にも出る）
      const rows = sumBy(monthItems, (e) => [e.category]).map((r) => ({ ...r, color: colorVar(r.label) }));
      return {
        orientation: 'horizontal',
        rows,
        tooltip: (r) => yen(r.amount) + '（' + percent(r.amount, total) + '）',
        table: {
          head: ['カテゴリ', '金額', '割合'],
          rows: rows.map((r) => [{ text: r.label, dot: r.color }, yen(r.amount), percent(r.amount, total)]),
        },
      };
    },

    // タグ別：タグごとの合計の横棒（タグなしは最後に薄い色で）
    tag(all, monthItems) {
      if (monthItems.length === 0) return { empty: 'この月の支出はまだありません' };
      const tagged = monthItems.filter((e) => e.tags.length > 0);
      if (tagged.length === 0) return { empty: 'この月はタグの付いた支出がありません' };
      const total = monthItems.reduce((s, e) => s + e.amount, 0);
      const rows = sumBy(tagged, (e) => e.tags).map((r) => ({ ...r, label: '#' + r.label }));
      const untagged = monthItems.filter((e) => e.tags.length === 0).reduce((s, e) => s + e.amount, 0);
      if (untagged > 0) rows.push({ label: 'タグなし', amount: untagged, muted: true });
      const multi = tagged.some((e) => e.tags.length > 1);
      return {
        orientation: 'horizontal',
        rows,
        tooltip: (r) => yen(r.amount) + '（月の合計の' + percent(r.amount, total) + '）',
        note: multi ? '※ 複数のタグが付いた支出は、それぞれのタグに数えています（割合の合計は100%を超えることがあります）' : '',
        table: { head: ['タグ', '金額', '割合'], rows: rows.map((r) => [r.label, yen(r.amount), percent(r.amount, total)]) },
      };
    },

    // 日別：その月の1日〜末日の縦棒
    daily(all, monthItems, month) {
      if (monthItems.length === 0) return { empty: 'この月の支出はまだありません' };
      const [y, m] = monthParts(month);
      const lastDay = new Date(y, m, 0).getDate();
      const sums = new Array(lastDay).fill(0);
      for (const e of monthItems) sums[Number(e.date.slice(8, 10)) - 1] += e.amount;
      const rows = sums.map((amount, i) => {
        const w = '日月火水木金土'[new Date(y, m - 1, i + 1).getDay()];
        return { label: String(i + 1), amount, title: m + '月' + (i + 1) + '日（' + w + '）' };
      });

      // 1日平均：今月なら今日まで、過去の月なら月の日数で割る
      const today = todayStr();
      const days = today.startsWith(month) ? Number(today.slice(8, 10)) : lastDay;
      const total = sums.reduce((s, v) => s + v, 0);
      const maxIndex = sums.indexOf(Math.max(...sums));
      return {
        orientation: 'vertical',
        rows,
        tooltip: (r) => yen(r.amount),
        note:
          '1日平均 ' + yen(total / days) + (today.startsWith(month) ? '（今日まで）' : '') +
          '・いちばん多い日 ' + m + '/' + (maxIndex + 1) + ' ' + yen(sums[maxIndex]),
        table: null, // 31行は長いので表は出さない（棒にカーソル/タップで金額が見える）
      };
    },

    // 月別推移：表示中の月までの6か月（表示中の月だけ濃い色）
    monthly(all, monthItems, month) {
      const months = [];
      for (let i = MONTHS_IN_TREND - 1; i >= 0; i--) months.push(shiftMonth(month, -i));
      const sums = new Map(months.map((ym) => [ym, 0]));
      for (const e of all) {
        const ym = e.date.slice(0, 7);
        if (sums.has(ym)) sums.set(ym, sums.get(ym) + e.amount);
      }
      const rows = months.map((ym) => {
        const [y, m] = monthParts(ym);
        return { label: m + '月', amount: sums.get(ym), muted: ym !== month, title: y + '年' + m + '月' };
      });
      const avg = rows.reduce((s, r) => s + r.amount, 0) / rows.length;
      const prev = rows[rows.length - 2].amount;
      const cur = rows[rows.length - 1].amount;
      const diff = cur - prev;
      return {
        orientation: 'vertical',
        rows,
        tooltip: (r) => yen(r.amount),
        note: MONTHS_IN_TREND + 'か月の平均 ' + yen(avg) + '・前月との差 ' + (diff >= 0 ? '+' : '−') + yen(Math.abs(diff)),
        table: {
          head: ['月', '金額', '前月比'],
          rows: rows
            .map((r, i) => {
              const before = i > 0 ? rows[i - 1].amount : null;
              const change = before ? Math.round(((r.amount - before) / before) * 100) : null;
              return [r.title, yen(r.amount), change === null ? '—' : (change >= 0 ? '+' : '') + change + '%'];
            })
            .reverse(), // 新しい月を上に
        },
      };
    },
  };

  // ---------- 描画 ----------
  function render(all, monthItems, month) {
    lastArgs = [all, monthItems, month];
    card.hidden = all.length === 0;
    if (card.hidden) return;

    if (!BUILDERS[type]) type = 'category';
    tabs.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.type === type)));

    const spec = BUILDERS[type](all, monthItems, month);

    note.textContent = spec.note || '';
    note.hidden = !spec.note;
    emptyEl.textContent = spec.empty || '';
    emptyEl.hidden = !spec.empty;

    // 表（グラフが読み込めないときの代わりにもなる）
    table.hidden = !spec.table;
    if (spec.table) {
      const tr = document.createElement('tr');
      for (const h of spec.table.head) tr.append(Object.assign(document.createElement('th'), { textContent: h }));
      thead.replaceChildren(tr);
      tbody.replaceChildren(
        ...spec.table.rows.map((cells) => {
          const row = document.createElement('tr');
          for (const c of cells) {
            const td = document.createElement('td');
            if (c && typeof c === 'object') {
              // 色の点＋文字（色だけに頼らず、必ず名前も出す）
              const d = document.createElement('span');
              d.className = 'dot';
              d.style.setProperty('--c', 'var(' + c.dot + ')');
              d.setAttribute('aria-hidden', 'true');
              td.append(d, document.createTextNode(c.text));
            } else {
              td.textContent = c;
            }
            row.append(td);
          }
          return row;
        })
      );
    }

    // グラフ本体（Chart.js が読み込めなかったとき・データが無いときは出さない）
    const canDraw = typeof window.Chart !== 'undefined' && !spec.empty;
    wrap.hidden = !canDraw;
    if (!canDraw) {
      destroyChart();
      return;
    }
    drawChart(spec);
  }

  function destroyChart() {
    if (chart) chart.destroy();
    chart = null;
    chartKey = '';
  }

  function drawChart(spec) {
    const horizontal = spec.orientation === 'horizontal';
    const colors = {
      bar: cssVar('--primary'),
      muted: cssVar('--bar-muted'),
      text: cssVar('--muted'),
      grid: cssVar('--border'),
    };

    const rowColor = (r) => (r.color ? cssVar(r.color) : r.muted ? colors.muted : colors.bar);
    const barColors = spec.rows.map(rowColor);

    // 中身が前回と同じなら描き直さない（絞り込みや選択のたびに動かないように）
    const key = JSON.stringify([type, spec.rows, colors, barColors]);
    if (chart && key === chartKey) return;
    destroyChart();
    chartKey = key;

    wrap.style.height = horizontal ? spec.rows.length * 34 + 28 + 'px' : '220px';
    canvas.setAttribute('aria-label', tabs.querySelector('[aria-selected="true"]').textContent + 'のグラフ');

    const font = { family: getComputedStyle(document.body).fontFamily, size: 12 };
    const valueAxis = {
      beginAtZero: true,
      border: { display: false },
      grid: { color: colors.grid },
      ticks: { color: colors.text, font, maxTicksLimit: 5, callback: (v) => yen(Number(v)) },
    };
    const labelAxis = {
      grid: { display: false },
      border: { display: false },
      ticks: { color: colors.text, font: horizontal ? { ...font, size: 13 } : font, autoSkip: true, maxRotation: 0 },
    };
    const rows = spec.rows;

    chart = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.label),
        datasets: [{
          data: rows.map((r) => r.amount),
          backgroundColor: barColors,
          hoverBackgroundColor: barColors,
        }],
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        maintainAspectRatio: false,
        animation: { duration: 250 },
        datasets: {
          bar: {
            borderRadius: 4,
            borderSkipped: 'start',
            maxBarThickness: horizontal ? 18 : 28,
            categoryPercentage: horizontal ? 0.8 : 0.85,
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => rows[items[0].dataIndex].title || rows[items[0].dataIndex].label,
              label: (ctx) => spec.tooltip(rows[ctx.dataIndex]),
            },
          },
        },
        scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis },
      },
    });
  }

  // ---------- 切り替え ----------
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b || b.dataset.type === type) return;
    type = b.dataset.type;
    saveType(type);
    if (lastArgs) render(...lastArgs);
  });

  // ライト/ダークが切り替わったら色も合わせる
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (lastArgs) render(...lastArgs);
    });
  }

  window.KakeiboCharts = { render };
})();
