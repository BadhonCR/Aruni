-- Aruni Chatrabas: Supabase PostgreSQL schema
-- Run this file in Supabase Dashboard > SQL Editor.
-- All application tables use RLS. Never expose the service_role key in frontend code.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'member' check (role in ('admin','manager','member')),
  preferred_language text not null default 'bn' check (preferred_language in ('bn','en')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  member_code text unique,
  full_name text not null,
  phone text,
  email text,
  room_no text,
  joining_date date,
  leaving_date date,
  status text not null default 'active' check (status in ('active','former','suspended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mess_months (
  id uuid primary key default gen_random_uuid(),
  month_start date not null unique,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  mess_month_id uuid not null references public.mess_months(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  payment_method text not null default 'cash' check (payment_method in ('cash','bank','mobile_banking','other')),
  reference text,
  note text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  mess_month_id uuid not null references public.mess_months(id) on delete restrict,
  title text not null,
  category text not null default 'other',
  amount numeric(12,2) not null check (amount > 0),
  spent_on date not null default current_date,
  receipt_url text,
  note text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  meal_date date not null,
  breakfast numeric(4,1) not null default 0 check (breakfast >= 0),
  lunch numeric(4,1) not null default 0 check (lunch >= 0),
  dinner numeric(4,1) not null default 0 check (dinner >= 0),
  note text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (member_id, meal_date)
);

create table if not exists public.meal_rates (
  id uuid primary key default gen_random_uuid(),
  mess_month_id uuid not null references public.mess_months(id) on delete cascade,
  rate_per_meal numeric(10,2) not null check (rate_per_meal >= 0),
  effective_from date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (mess_month_id, effective_from)
);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists members_status_idx on public.members(status);
create index if not exists deposits_month_member_idx on public.deposits(mess_month_id, member_id);
create index if not exists expenses_month_idx on public.expenses(mess_month_id);
create index if not exists meal_entries_date_member_idx on public.meal_entries(meal_date, member_id);
create index if not exists notices_published_idx on public.notices(is_published, published_at desc);

-- A new authenticated account receives a basic member profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Helper functions avoid recursive profile-table RLS checks.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active = true
  limit 1;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin','manager'), false);
$$;

alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.mess_months enable row level security;
alter table public.deposits enable row level security;
alter table public.expenses enable row level security;
alter table public.meal_entries enable row level security;
alter table public.meal_rates enable row level security;
alter table public.notices enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: users can read/update their own basic profile; staff can manage all.
drop policy if exists "profiles_select_own_or_staff" on public.profiles;
create policy "profiles_select_own_or_staff" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or public.is_staff());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
for update to authenticated
using (id = (select auth.uid()) or public.current_app_role() = 'admin')
with check (
  (id = (select auth.uid()) and role = (select public.current_app_role()))
  or public.current_app_role() = 'admin'
);

drop policy if exists "profiles_insert_admin_only" on public.profiles;
create policy "profiles_insert_admin_only" on public.profiles
for insert to authenticated
with check (public.current_app_role() = 'admin');

-- Members: members can view their own record; staff can manage the roster.
drop policy if exists "members_select_self_or_staff" on public.members;
create policy "members_select_self_or_staff" on public.members
for select to authenticated
using (user_id = (select auth.uid()) or public.is_staff());

drop policy if exists "members_staff_manage" on public.members;
create policy "members_staff_manage" on public.members
for all to authenticated
using (public.is_staff())
with check (public.is_staff());

-- Mess-wide summaries are visible to authenticated members; changes are staff-only.
drop policy if exists "months_read_authenticated" on public.mess_months;
create policy "months_read_authenticated" on public.mess_months
for select to authenticated using (true);
drop policy if exists "months_staff_manage" on public.mess_months;
create policy "months_staff_manage" on public.mess_months
for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "deposits_read_self_or_staff" on public.deposits;
create policy "deposits_read_self_or_staff" on public.deposits
for select to authenticated
using (
  public.is_staff()
  or exists (select 1 from public.members m where m.id = member_id and m.user_id = (select auth.uid()))
);
drop policy if exists "deposits_staff_manage" on public.deposits;
create policy "deposits_staff_manage" on public.deposits
for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "expenses_read_authenticated" on public.expenses;
create policy "expenses_read_authenticated" on public.expenses
for select to authenticated using (true);
drop policy if exists "expenses_staff_manage" on public.expenses;
create policy "expenses_staff_manage" on public.expenses
for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "meals_read_self_or_staff" on public.meal_entries;
create policy "meals_read_self_or_staff" on public.meal_entries
for select to authenticated
using (
  public.is_staff()
  or exists (select 1 from public.members m where m.id = member_id and m.user_id = (select auth.uid()))
);
drop policy if exists "meals_staff_manage" on public.meal_entries;
create policy "meals_staff_manage" on public.meal_entries
for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "meal_rates_read_authenticated" on public.meal_rates;
create policy "meal_rates_read_authenticated" on public.meal_rates
for select to authenticated using (true);
drop policy if exists "meal_rates_staff_manage" on public.meal_rates;
create policy "meal_rates_staff_manage" on public.meal_rates
for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "notices_read_published_or_staff" on public.notices;
create policy "notices_read_published_or_staff" on public.notices
for select to authenticated using (is_published = true or public.is_staff());
drop policy if exists "notices_staff_manage" on public.notices;
create policy "notices_staff_manage" on public.notices
for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "audit_logs_admin_read" on public.audit_logs;
create policy "audit_logs_admin_read" on public.audit_logs
for select to authenticated using (public.current_app_role() = 'admin');
drop policy if exists "audit_logs_staff_insert" on public.audit_logs;
create policy "audit_logs_staff_insert" on public.audit_logs
for insert to authenticated with check (public.is_staff());

-- Important: promote the first trusted account to admin manually in the SQL Editor
-- after signing up, replacing the UUID with that account's auth.users id:
-- update public.profiles set role = 'admin' where id = 'YOUR-AUTH-USER-UUID';
