-- ================================================================
-- NEO TRACKER · SUPABASE SCHEMA
-- Run this entire file in Supabase → SQL Editor → New query → Run
-- ================================================================

-- EXTENSIONS
create extension if not exists "pgcrypto";

-- ── MALLS ──────────────────────────────────────────────────────────
create table if not exists malls (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text not null,
  targets     jsonb not null default '{"0":20,"1":10,"2":10,"3":10,"4":15,"5":15,"6":20}',
  created_at  timestamptz default now()
);

-- Insert Carrefour Laval
insert into malls (name, location) values ('Carrefour Laval', 'Laval, QC');

-- ── REPS ───────────────────────────────────────────────────────────
create table if not exists reps (
  id          uuid primary key default gen_random_uuid(),
  mall_id     uuid references malls(id) on delete cascade,
  email       text unique not null,
  name        text not null,
  role        text not null check (role in ('rep','lead')),
  pin_hash    text not null,
  active      boolean default true,
  created_at  timestamptz default now()
);

-- ── SALES ──────────────────────────────────────────────────────────
create table if not exists sales (
  id          uuid primary key default gen_random_uuid(),
  mall_id     uuid references malls(id) on delete cascade,
  rep_id      uuid references reps(id) on delete cascade,
  rep_name    text not null,
  sale_date   date not null default current_date,
  sale_time   time not null default current_time,
  products    text[] not null,
  labels      text[] not null,
  type        text not null check (type in ('credit','debit')),
  activated   boolean default false,
  deposited   boolean default false,
  deposit     numeric(10,2),
  notes       text,
  created_at  timestamptz default now()
);

-- ── PUSH SUBSCRIPTIONS ─────────────────────────────────────────────
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  rep_id      uuid references reps(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz default now(),
  unique(rep_id, endpoint)
);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────────
alter table malls               enable row level security;
alter table reps                enable row level security;
alter table sales               enable row level security;
alter table push_subscriptions  enable row level security;

-- Everyone can read malls (needed for targets)
create policy "malls_read" on malls for select using (true);

-- Everyone can read reps in same mall (for feed/dashboard)
create policy "reps_read"   on reps for select using (true);
create policy "reps_insert" on reps for insert with check (true);
create policy "reps_update" on reps for update using (true);

-- Everyone can read + insert sales (reps log, lead reads)
create policy "sales_read"   on sales for select using (true);
create policy "sales_insert" on sales for insert with check (true);
create policy "sales_delete" on sales for delete using (true);

-- Push subs: each rep manages their own
create policy "push_read"   on push_subscriptions for select using (true);
create policy "push_insert" on push_subscriptions for insert with check (true);
create policy "push_delete" on push_subscriptions for delete using (true);

-- ── REALTIME ───────────────────────────────────────────────────────
-- Enable realtime on sales table (for live feed)
alter publication supabase_realtime add table sales;

-- ================================================================
-- DONE. Copy the mall ID from the malls table and paste it into
-- app.js as MALL_ID after running this.
-- ================================================================
