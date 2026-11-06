/*
 * config.js — 接続先の設定
 *
 * Supabase の「Project URL」と「anon（公開用）キー」を入れると、データがクラウドに保存され、
 * スマホとPCで同じデータを使えるようになる。空のままなら、今までどおりブラウザの中だけに保存する。
 *
 * ※ anon キーは「公開してよい」前提のキー（ブラウザから使うためのもの）。
 *    データはログインした本人しか読み書きできないよう、データベース側（supabase/schema.sql）で守っている。
 *    「service_role」キーは絶対にここに書かないこと。
 */
window.KAKEIBO_CONFIG = {
  supabaseUrl: 'https://ovrzbcgguuxxjjoyzpjn.supabase.co',
  supabaseAnonKey: 'sb_publishable_Z33ojPqK7bKRxN4k3Cwgrw_1bf2vcqX',
};
