/*
 * storage.js — データの読み書きとログインはすべてこのファイルに集約する
 *
 * 保存先は2種類あり、js/config.js の設定で自動的に切り替わる。
 *   ・ブラウザの中（localStorage）… 設定が空のとき
 *   ・クラウド（Supabase）        … Supabase の URL とキーが入っているとき
 * 画面側は次のストアのメソッドだけを使うので、保存先が変わっても書き換えは要らない。
 * どれも Promise を返す（async）。
 *
 * ■ window.ExpenseStore（支出）
 *   list()                 → 全支出の配列（日付の新しい順）
 *   add(input, options)    → 追加して、保存された支出を返す
 *                             options.ignoreDuplicate … 同じサブスクの同じ回がすでにあれば何もせず null を返す
 *   update(id, changes)    → 更新して、更新後の支出を返す
 *   remove(id)             → 削除する
 *   removeMany(ids)        → まとめて削除する（一括削除用）
 *   removeByCategory(c)    → そのカテゴリの支出をすべて削除し、件数を返す（カテゴリを廃止したとき用）
 *
 *   支出データの形：
 *   {
 *     id:             string    一意なID
 *     date:           string    'YYYY-MM-DD'
 *     amount:         number    円（正の整数）
 *     category:       string
 *     memo:           string
 *     tags:           string[]  自由に付けられるタグ（カテゴリとは別。例：「旅行」「立替」）
 *     subscriptionId: string|null  サブスクから自動で記録した支出なら、そのサブスクのID
 *     createdAt:      string    ISO日時
 *     updatedAt:      string    ISO日時
 *   }
 *
 * ■ window.SubscriptionStore（サブスク）
 *   list() / add(input) / update(id, changes) / remove(id) / removeByCategory(category)
 *
 *   サブスクデータの形：
 *   {
 *     id:             string
 *     name:           string   サービス名（例：動画配信）
 *     amount:         number   1回の支払額（円）
 *     category:       string
 *     cycle:          'monthly' | 'yearly'
 *     startDate:      string   'YYYY-MM-DD' 最初の支払日。以後この日付を基準に毎月/毎年
 *     active:         boolean  false なら一時停止中（支出を自動で記録しない）
 *     generatedUntil: string   'YYYY-MM-DD' ここまでの支払いは支出に記録済み（'' なら未記録）
 *     createdAt / updatedAt
 *   }
 *
 * ■ window.KakeiboAuth（ログイン。クラウドのときだけ意味がある）
 *   enabled                → クラウドを使う設定なら true
 *   getUser()              → ログイン中のユーザー（{ id, email }）か null
 *   signIn(email, pass)    → ログイン
 *   signOut()              → ログアウト
 *
 * ■ window.KakeiboSync（同期の状態）
 *   status                 → 'local' | 'online' | 'offline'（offline は端末の控えを表示中）
 *   onChange(fn)           → 状態が変わったら fn(status) を呼ぶ
 *   uploadLocalData()      → この端末（localStorage）のデータをクラウドへ移す
 *   localDataCount()       → この端末に残っているデータの件数
 */
(function (global) {
  'use strict';

  const EXPENSES_KEY = 'kakeibo.expenses.v1';
  const SUBSCRIPTIONS_KEY = 'kakeibo.subscriptions.v1';
  const CACHE_PREFIX = 'kakeibo.cache.'; // クラウドから最後に読んだデータの控え
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function generateId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    // file:// で開いたときなど randomUUID が使えない環境向け
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ---------- 入力値のチェックと整形（保存先に関係なく共通） ----------
  function normalizeAmount(value) {
    const amount = Math.round(Number(value));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('金額は1円以上で入力してください');
    return amount;
  }

  function normalizeCategory(value) {
    const category = String(value || '').trim();
    if (!category) throw new Error('カテゴリを選んでください');
    return category;
  }

  function normalizeExpense(input) {
    const date = String(input.date || '');
    if (!DATE_RE.test(date)) throw new Error('日付が正しくありません');
    return {
      date,
      amount: normalizeAmount(input.amount),
      category: normalizeCategory(input.category),
      memo: String(input.memo || '').trim(),
      tags: normalizeTags(input.tags),
      subscriptionId: input.subscriptionId ? String(input.subscriptionId) : null,
    };
  }

  function normalizeSubscription(input) {
    const name = String(input.name || '').trim().slice(0, 40);
    if (!name) throw new Error('サービス名を入力してください');
    const startDate = String(input.startDate || '');
    if (!DATE_RE.test(startDate)) throw new Error('支払日が正しくありません');
    const cycle = input.cycle === 'yearly' ? 'yearly' : 'monthly';
    const generatedUntil = DATE_RE.test(String(input.generatedUntil || '')) ? input.generatedUntil : '';
    return {
      name,
      amount: normalizeAmount(input.amount),
      category: normalizeCategory(input.category),
      cycle,
      startDate,
      active: input.active !== false,
      generatedUntil,
    };
  }

  // タグ：前後の空白と先頭の # を取り、空・重複を除く（最大10個・各20文字）
  const MAX_TAGS = 10;
  const MAX_TAG_LENGTH = 20;
  function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    const result = [];
    for (const t of tags) {
      const tag = String(t).trim().replace(/^[#＃]+/, '').slice(0, MAX_TAG_LENGTH);
      if (tag && !result.includes(tag)) result.push(tag);
      if (result.length >= MAX_TAGS) break;
    }
    return result;
  }

  function sortExpenses(list) {
    return list.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 容量不足などは無視（控えなので） */ }
  }

  // 古いバージョンで保存したデータには tags などが無いので補う
  function fillExpense(e) {
    return { ...e, tags: Array.isArray(e.tags) ? e.tags : [], subscriptionId: e.subscriptionId || null };
  }

  // =========================================================
  // ブラウザの中（localStorage）に保存する実装
  // =========================================================
  function createLocalCollection(key, normalize, label) {
    const readAll = () => readJSON(key);
    const writeAll = (list) => localStorage.setItem(key, JSON.stringify(list));
    return {
      readAll,
      async add(input) {
        const now = new Date().toISOString();
        const item = { id: generateId(), ...normalize(input), createdAt: now, updatedAt: now };
        const list = readAll();
        list.push(item);
        writeAll(list);
        return item;
      },
      async update(id, changes) {
        const list = readAll();
        const index = list.findIndex((e) => e.id === id);
        if (index === -1) throw new Error('対象の' + label + 'が見つかりません');
        list[index] = {
          ...list[index],
          ...normalize({ ...list[index], ...changes }),
          updatedAt: new Date().toISOString(),
        };
        writeAll(list);
        return list[index];
      },
      async remove(id) {
        writeAll(readAll().filter((e) => e.id !== id));
      },
      async removeMany(ids) {
        const set = new Set(ids);
        writeAll(readAll().filter((e) => !set.has(e.id)));
      },
      async removeByCategory(category) {
        const list = readAll();
        const rest = list.filter((e) => e.category !== category);
        if (rest.length !== list.length) writeAll(rest);
        return list.length - rest.length;
      },
    };
  }

  function createLocalExpenseStore() {
    const c = createLocalCollection(EXPENSES_KEY, normalizeExpense, '支出');
    return {
      async list() {
        return sortExpenses(c.readAll().map(fillExpense));
      },
      async add(input, options = {}) {
        if (options.ignoreDuplicate && input.subscriptionId) {
          const dup = c.readAll().some((e) => e.subscriptionId === input.subscriptionId && e.date === input.date);
          if (dup) return null;
        }
        return c.add(input);
      },
      update: c.update,
      remove: c.remove,
      removeMany: c.removeMany,
      removeByCategory: c.removeByCategory,
    };
  }

  function createLocalSubscriptionStore() {
    const c = createLocalCollection(SUBSCRIPTIONS_KEY, normalizeSubscription, 'サブスク');
    return {
      async list() {
        return c.readAll().sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      },
      add: c.add,
      update: c.update,
      remove: c.remove,
      removeByCategory: c.removeByCategory,
    };
  }

  // =========================================================
  // クラウド（Supabase）に保存する実装
  // =========================================================
  const sync = {
    status: 'local',
    listeners: [],
    set(status) {
      if (this.status === status) return;
      this.status = status;
      this.listeners.forEach((fn) => fn(status));
    },
  };

  // 通信エラーを、わかりやすい日本語にする
  function cloudError(error, action) {
    if (!navigator.onLine) return new Error('オフラインのため' + action + 'できませんでした。電波の良いところでもう一度お試しください');
    const msg = (error && error.message) || '';
    if (/JWT|token|auth/i.test(msg)) return new Error('ログインの有効期限が切れました。もう一度ログインしてください');
    return new Error(action + 'に失敗しました（' + msg + '）');
  }

  function ensureOnline(action) {
    if (!navigator.onLine) throw new Error('オフラインのため' + action + 'できません。電波の良いところでもう一度お試しください');
  }

  // 1000件ずつに分けて全件読む（Supabase は1回に最大1000件まで）
  async function fetchAll(client, table, order) {
    const PAGE = 1000;
    let rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = client.from(table).select('*');
      for (const [col, asc] of order) q = q.order(col, { ascending: asc });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      rows = rows.concat(data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  // データベースの列名（snake_case）⇔ アプリの名前（camelCase）
  const expenseFromRow = (r) => ({
    id: r.id,
    date: r.date,
    amount: r.amount,
    category: r.category,
    memo: r.memo || '',
    tags: r.tags || [],
    subscriptionId: r.subscription_id || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  const expenseToRow = (e) => ({
    date: e.date,
    amount: e.amount,
    category: e.category,
    memo: e.memo,
    tags: e.tags,
    subscription_id: e.subscriptionId,
  });
  const subFromRow = (r) => ({
    id: r.id,
    name: r.name,
    amount: r.amount,
    category: r.category,
    cycle: r.cycle,
    startDate: r.start_date,
    active: r.active,
    generatedUntil: r.generated_until || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  const subToRow = (s) => ({
    name: s.name,
    amount: s.amount,
    category: s.category,
    cycle: s.cycle,
    start_date: s.startDate,
    active: s.active,
    generated_until: s.generatedUntil || null,
  });

  function createCloudStore(client, { table, label, normalize, fromRow, toRow, order, sort }) {
    const cacheKey = CACHE_PREFIX + table;

    async function getOne(id) {
      const { data, error } = await client.from(table).select('*').eq('id', id).single();
      if (error) throw cloudError(error, '読み込み');
      return fromRow(data);
    }

    return {
      async list() {
        try {
          const items = sort((await fetchAll(client, table, order)).map(fromRow));
          writeJSON(cacheKey, items);
          sync.set('online');
          return items;
        } catch (error) {
          // 読めなかったときは、最後に読んだ控えを表示する
          console.warn(label + 'をクラウドから読めませんでした。端末の控えを表示します', error);
          sync.set('offline');
          return sort(readJSON(cacheKey).map((x) => (table === 'expenses' ? fillExpense(x) : x)));
        }
      },

      async add(input, options = {}) {
        ensureOnline('保存');
        const row = toRow(normalize(input));
        let query;
        if (options.ignoreDuplicate && row.subscription_id) {
          // 同じサブスクの同じ回がすでにあれば何もしない（スマホとPCで二重に記録しないため）
          query = client.from(table).upsert(row, { onConflict: 'user_id,subscription_id,date', ignoreDuplicates: true }).select();
        } else {
          query = client.from(table).insert(row).select();
        }
        const { data, error } = await query;
        if (error) throw cloudError(error, '保存');
        return data && data[0] ? fromRow(data[0]) : null;
      },

      async update(id, changes) {
        ensureOnline('保存');
        const current = await getOne(id);
        const row = toRow(normalize({ ...current, ...changes }));
        const { data, error } = await client.from(table).update(row).eq('id', id).select().single();
        if (error) throw cloudError(error, '保存');
        return fromRow(data);
      },

      async remove(id) {
        ensureOnline('削除');
        const { error } = await client.from(table).delete().eq('id', id);
        if (error) throw cloudError(error, '削除');
      },

      async removeMany(ids) {
        ensureOnline('削除');
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await client.from(table).delete().in('id', ids.slice(i, i + 200));
          if (error) throw cloudError(error, '削除');
        }
      },

      async removeByCategory(category) {
        ensureOnline('削除');
        const { data, error } = await client.from(table).delete().eq('category', category).select('id');
        if (error) throw cloudError(error, '削除');
        return data ? data.length : 0;
      },
    };
  }

  // この端末（localStorage）のデータをクラウドへ移す。移した件数を返す
  async function uploadLocalData(client) {
    ensureOnline('データの移行');
    const subs = readJSON(SUBSCRIPTIONS_KEY);
    const expenses = readJSON(EXPENSES_KEY).map(fillExpense);
    let count = 0;

    // サブスクは ID をそのまま使う（支出の subscriptionId とつながったままにするため）
    if (subs.length) {
      const rows = subs.map((s) => ({ id: s.id, ...subToRow(normalizeSubscription(s)) }));
      const { error } = await client.from('subscriptions').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw cloudError(error, 'サブスクの移行');
      count += rows.length;
    }

    // 作成日時も引き継ぐ（全行に必ず入れる。まとめて送るとき、抜けた列は空として扱われるため）
    const now = new Date().toISOString();
    const toRow = (e) => ({ id: e.id, ...expenseToRow(normalizeExpense(e)), created_at: e.createdAt || now });
    // 普通の支出はまとめて送る（同じIDがすでにあれば飛ばすので、2回押しても増えない）
    const plain = expenses.filter((e) => !e.subscriptionId).map(toRow);
    for (let i = 0; i < plain.length; i += 500) {
      const { error } = await client.from('expenses').upsert(plain.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw cloudError(error, '支出の移行');
    }
    count += plain.length;

    // サブスクから記録した支出は、同じ回がすでにあれば飛ばす
    for (const e of expenses.filter((x) => x.subscriptionId)) {
      const { error } = await client
        .from('expenses')
        .upsert(toRow(e), { onConflict: 'user_id,subscription_id,date', ignoreDuplicates: true });
      if (error && !/duplicate key/i.test(error.message)) throw cloudError(error, '支出の移行');
      count++;
    }
    return count;
  }

  // =========================================================
  // どちらを使うか決める
  // =========================================================
  const config = global.KAKEIBO_CONFIG || {};
  const useCloud = Boolean(config.supabaseUrl && config.supabaseAnonKey && global.supabase && global.supabase.createClient);

  if (config.supabaseUrl && !useCloud) {
    console.error('Supabase のライブラリを読み込めませんでした。ブラウザの中に保存します');
  }

  if (useCloud) {
    const client = global.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    global.ExpenseStore = createCloudStore(client, {
      table: 'expenses',
      label: '支出',
      normalize: normalizeExpense,
      fromRow: expenseFromRow,
      toRow: expenseToRow,
      order: [['date', false], ['created_at', false]],
      sort: sortExpenses,
    });
    global.SubscriptionStore = createCloudStore(client, {
      table: 'subscriptions',
      label: 'サブスク',
      normalize: normalizeSubscription,
      fromRow: subFromRow,
      toRow: subToRow,
      order: [['name', true]],
      sort: (list) => list.sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    });

    global.KakeiboAuth = {
      enabled: true,
      async getUser() {
        const { data } = await client.auth.getSession();
        const u = data && data.session && data.session.user;
        return u ? { id: u.id, email: u.email } : null;
      },
      async signIn(email, password) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          if (/invalid login credentials/i.test(error.message)) throw new Error('メールアドレスかパスワードが違います');
          if (!navigator.onLine) throw new Error('オフラインのためログインできません');
          throw new Error('ログインできませんでした（' + error.message + '）');
        }
        return { id: data.user.id, email: data.user.email };
      },
      async signOut() {
        await client.auth.signOut();
        // 他の人に見られないよう、端末の控えも消す
        Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
      },
    };

    global.KakeiboSync = {
      get status() { return sync.status; },
      onChange(fn) { sync.listeners.push(fn); },
      uploadLocalData: () => uploadLocalData(client),
      localDataCount: () => readJSON(EXPENSES_KEY).length + readJSON(SUBSCRIPTIONS_KEY).length,
    };
    sync.status = 'online';
  } else {
    global.ExpenseStore = createLocalExpenseStore();
    global.SubscriptionStore = createLocalSubscriptionStore();
    global.KakeiboAuth = {
      enabled: false,
      async getUser() { return null; },
      async signIn() { throw new Error('クラウドの設定がされていません'); },
      async signOut() {},
    };
    global.KakeiboSync = {
      get status() { return 'local'; },
      onChange() {},
      async uploadLocalData() { return 0; },
      localDataCount: () => 0,
    };
  }

  global.ExpenseStore.normalizeTags = normalizeTags; // 画面側でも同じルールでタグを整えるため
})(window);
