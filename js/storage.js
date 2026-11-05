/*
 * storage.js — データの読み書きはすべてこのファイルに集約する
 *
 * 画面側は次の2つのストアのメソッドだけを使う。どれも Promise を返す（async）。
 * 今は localStorage なので同期的に終わるが、ステップ4で Supabase / Firebase に替えたときも
 * 画面側を書き換えずに済むようにしている。差し替えるときは、同じメソッドを持つ
 * 別の実装を作り、一番下の `global.ExpenseStore = ...` などの行を変えるだけ。
 *
 * ■ window.ExpenseStore（支出）
 *   list()               → 全支出の配列（日付の新しい順）
 *   add(input)           → 追加して、保存された支出を返す
 *   update(id, changes)  → 更新して、更新後の支出を返す
 *   remove(id)           → 削除する
 *   removeMany(ids)      → まとめて削除する（一括削除用）
 *   removeByCategory(c)  → そのカテゴリの支出をすべて削除し、件数を返す（カテゴリを廃止したとき用）
 *
 *   支出データの形：
 *   {
 *     id:             string    一意なID（クラウド同期でもそのまま主キーにできる）
 *     date:           string    'YYYY-MM-DD'
 *     amount:         number    円（正の整数）
 *     category:       string
 *     memo:           string
 *     tags:           string[]  自由に付けられるタグ（カテゴリとは別。例：「旅行」「立替」）
 *     subscriptionId: string|null  サブスクから自動で記録した支出なら、そのサブスクのID
 *     createdAt:      string    ISO日時
 *     updatedAt:      string    ISO日時（同期時に「どちらが新しいか」の判定に使える）
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
 */
(function (global) {
  'use strict';

  const EXPENSES_KEY = 'kakeibo.expenses.v1';
  const SUBSCRIPTIONS_KEY = 'kakeibo.subscriptions.v1';
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function generateId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    // file:// で開いたときなど randomUUID が使えない環境向け
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

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

  // 支出：入力値を保存用の形に整える（不正な値はエラーにする）
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

  // サブスク：入力値を保存用の形に整える
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

  // localStorage に配列として保存する入れ物（支出・サブスクで共通）
  function createLocalCollection(key, normalize, label) {
    function readAll() {
      try {
        const raw = localStorage.getItem(key);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.error(label + 'の読み込みに失敗しました', e);
        return [];
      }
    }
    function writeAll(list) {
      localStorage.setItem(key, JSON.stringify(list));
    }
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
      // 指定したカテゴリのものをすべて削除し、消した件数を返す
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
        // 古いバージョンで保存したデータには tags などが無いので補う
        return c
          .readAll()
          .map((e) => ({ ...e, tags: Array.isArray(e.tags) ? e.tags : [], subscriptionId: e.subscriptionId || null }))
          .sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? 1 : -1;
            return a.createdAt < b.createdAt ? 1 : -1;
          });
      },
      add: c.add,
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

  // ▼ ステップ4ではここを createSupabaseExpenseStore() などに差し替える
  global.ExpenseStore = createLocalExpenseStore();
  global.SubscriptionStore = createLocalSubscriptionStore();
  global.ExpenseStore.normalizeTags = normalizeTags; // 画面側でも同じルールでタグを整えるため
})(window);
