-- ══════════════════════════════════════════════════════════════════
-- Neo Tracker · Multi-mall migration  (production-safe)
-- Run once in Supabase SQL Editor → Dashboard → SQL Editor → New query
-- Safe to re-run: all DDL uses IF NOT EXISTS / IF EXISTS guards
-- ══════════════════════════════════════════════════════════════════

-- ── 1. DISTRICTS TABLE ────────────────────────────────────────────
create table if not exists districts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz default now()
);

alter table districts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='districts' and policyname='districts_select') then
    create policy "districts_select" on districts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='districts' and policyname='districts_insert') then
    create policy "districts_insert" on districts for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='districts' and policyname='districts_update') then
    create policy "districts_update" on districts for update using (true);
  end if;
end $$;

-- ── 2. ALTER EXISTING TABLES ──────────────────────────────────────
alter table malls add column if not exists district_id uuid references districts(id);

alter table reps  add column if not exists district_id uuid references districts(id);
alter table reps  add column if not exists added_by    uuid references reps(id);

-- Extend role constraint to include manager + admin
alter table reps drop constraint if exists reps_role_check;
alter table reps add  constraint reps_role_check
  check (role in ('rep', 'lead', 'manager', 'admin'));

-- Enable RLS on malls + add insert policy for managers
alter table malls enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='malls' and policyname='malls_select') then
    create policy "malls_select" on malls for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='malls' and policyname='malls_insert') then
    create policy "malls_insert" on malls for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='malls' and policyname='malls_update') then
    create policy "malls_update" on malls for update using (true);
  end if;
end $$;

-- ── 3. SEED: Ontario East region ─────────────────────────────────
-- Uses CTEs so all IDs are real gen_random_uuid() values.
-- ON CONFLICT ON CONSTRAINT districts_name_key means re-running is safe.

with
  mtl as (
    insert into districts (name)
    values ('Montréal')
    on conflict (name) do update set name = excluded.name   -- no-op, just returns row
    returning id, name
  ),
  ott as (
    insert into districts (name)
    values ('Ottawa')
    on conflict (name) do update set name = excluded.name
    returning id, name
  ),

  -- Tag existing St-Bruno mall with Montréal district (name unchanged)
  _stbruno as (
    update malls
       set district_id = (select id from mtl)
     where id = '2f153b45-2124-4bff-9008-32c4c145c8c7'
    returning id
  ),

  -- Insert new Montréal malls
  _mtl_malls as (
    insert into malls (name, location, district_id, targets, cph_target, acph_target)
    select
      m.name,
      m.location,
      (select id from mtl),
      '{"0":20,"1":10,"2":10,"3":10,"4":15,"5":15,"6":20}'::jsonb,
      2.0, 1.5
    from (values
      ('CF Laval', 'Laval, QC')
    ) as m(name, location)
    where not exists (select 1 from malls where name = m.name)
    returning id, name
  ),

  -- Insert new Ottawa malls
  _ott_malls as (
    insert into malls (name, location, district_id, targets, cph_target, acph_target)
    select
      m.name,
      m.location,
      (select id from ott),
      '{"0":20,"1":10,"2":10,"3":10,"4":15,"5":15,"6":20}'::jsonb,
      2.0, 1.5
    from (values
      ('CF Rideau',        'Ottawa, ON'),
      ('Place St-Laurent', 'Ottawa, ON'),
      ('Bayshore',         'Nepean, ON'),
      ('Tanger''s Outlets','Kanata, ON')
    ) as m(name, location)
    where not exists (select 1 from malls where name = m.name)
    returning id, name
  )

-- Return a summary so you can verify in the SQL editor output
select 'district' as type, id::text, name from mtl
union all
select 'district', id::text, name from ott
union all
select 'mall (new)', id::text, name from _mtl_malls
union all
select 'mall (new)', id::text, name from _ott_malls;

-- ══════════════════════════════════════════════════════════════════
-- VERIFY after running:
--   select d.name as district, m.name as mall
--     from malls m join districts d on d.id = m.district_id
--    order by d.name, m.name;
--
--   select role, count(*) from reps group by role;
-- ══════════════════════════════════════════════════════════════════
