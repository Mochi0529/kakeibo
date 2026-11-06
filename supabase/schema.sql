-- =========================================================
-- 家計簿アプリ用のテーブル（Supabase の SQL Editor に貼り付けて「Run」）
--
-- ・expenses      … 支出
-- ・subscriptions … サブスク（定期払い）
-- どちらも「ログインした本人の行しか読み書きできない」ようにしてある（Row Level Security）。
-- 何度実行しても壊れないように書いてある。
-- =========================================================

-- ---------- 支出 ----------
create table if not exists public.expenses (
  id              text primary key default gen_random_uuid()::text,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date            date not null,
  amount          integer not null check (amount > 0),
  category        text not null,
  memo            text not null default '',
  tags            text[] not null default '{}',
  subscription_id text,               -- サブスクから自動で記録した支出なら、そのサブスクのID
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- スマホとPCが同時に開いても、同じサブスクの同じ回が二重に記録されないようにする
  -- （subscription_id が空の普通の支出は、この制約に引っかからない）
  constraint expenses_subscription_once unique (user_id, subscription_id, date)
);

create index if not exists expenses_user_date on public.expenses (user_id, date desc);

-- ---------- サブスク ----------
create table if not exists public.subscriptions (
  id              text primary key default gen_random_uuid()::text,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null,
  amount          integer not null check (amount > 0),
  category        text not null,
  cycle           text not null check (cycle in ('monthly', 'yearly')),
  start_date      date not null,
  active          boolean not null default true,
  generated_until date,               -- ここまでの支払いは支出に記録済み
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- 更新日時を自動で入れる ----------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before update on public.expenses
  for each row execute function public.touch_updated_at();

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- ---------- 本人の行だけ読み書きできるようにする ----------
alter table public.expenses enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own subscriptions" on public.subscriptions;
create policy "own subscriptions" on public.subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- アプリ（ログイン済みの人）に表の使用を許可する ----------
-- 「Automatically expose new tables」をオフにしたプロジェクトでも動くように明示する。
-- ログインしていない人（anon）には何も許可しない。
revoke all on public.expenses, public.subscriptions from anon;
grant select, insert, update, delete on public.expenses, public.subscriptions to authenticated;
