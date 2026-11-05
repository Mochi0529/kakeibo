/*
 * categories.js — カテゴリの一覧と色
 *
 * 色は CSS の --cat-1 〜 --cat-9（css/style.css で定義、ライト/ダークで別の値）を使う。
 * 1〜8は色覚の違いがあっても隣同士を見分けやすい順に並べた検証済みの配色、
 * 9は既存の8色すべてと十分に離れるよう計算で選び、検証ツールで確認した色。
 * 順番を入れ替えないこと。色の無いカテゴリ（「その他」など）はグレー（--cat-other）にする。
 * 色だけに頼らないよう、画面では必ずカテゴリ名と一緒に表示する。
 */
(function (global) {
  'use strict';

  // カテゴリを増減するときはここを編集する（先頭から順に色が付く。「その他」は常にグレー）
  const CATEGORIES = ['食費', '日用品', '交通費', '水道光熱', '通信', '娯楽', '交際費', '医療', '衣服', 'その他'];
  const COLOR_SLOTS = 9;

  function colorVar(category) {
    const i = CATEGORIES.indexOf(category);
    if (category === 'その他' || i < 0 || i >= COLOR_SLOTS) return '--cat-other';
    return '--cat-' + (i + 1);
  }

  // 色の上に文字を載せるときの文字色（黄色の上だけ黒、それ以外は白）
  function inkVar(category) {
    return colorVar(category) === '--cat-4' ? '--cat-ink-dark' : '--cat-ink';
  }

  global.KakeiboCategories = { CATEGORIES, colorVar, inkVar };
})(window);
