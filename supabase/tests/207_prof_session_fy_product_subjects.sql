-- Production-like Final Year product-subject ensure + legacy Day soft-delete
-- (mirrors preflight: Gynecology present, Medicine/Surgery/Pediatrics missing,
-- year-level published Day 1 with no linked content).
begin;
select plan(13);

select test_helpers.as_runner();

-- Use seeded Year 5
select id into temp t_fy from public.years where year_number = 5 limit 1;

-- Ensure Blocks 1–12 exist (seed/migration normally do); assert product keys later
create temp table t_block_n as
select count(*)::int as n
from public.subjects s
join public.years y on y.id = s.year_id
where s.product_key like 'block-%';

-- Simulate production Final Year: Gynecology with product_key; departmental
-- Medicine I / Surgery I without product keys (must NOT be remapped).
insert into public.subjects (year_id, name, sort_order, product_key)
select (select id from t_fy), 'Gynecology', 3, 'gynecology'
where not exists (
  select 1 from public.subjects
  where year_id = (select id from t_fy) and product_key = 'gynecology'
);

insert into public.subjects (year_id, name, sort_order)
select (select id from t_fy), 'Medicine I', 10
where not exists (
  select 1 from public.subjects
  where year_id = (select id from t_fy) and name = 'Medicine I'
);

insert into public.subjects (year_id, name, sort_order)
select (select id from t_fy), 'Surgery I', 11
where not exists (
  select 1 from public.subjects
  where year_id = (select id from t_fy) and name = 'Surgery I'
);

-- Remove Medicine/Surgery/Pediatrics product rows if a prior seed created them,
-- so this file exercises the ensure path (only when product_key matches).
delete from public.subjects
where year_id = (select id from t_fy)
  and product_key in ('medicine', 'surgery', 'pediatrics');

-- Legacy year-level Day (chrome only): soft-deleted, subject_id null — never mapped.
insert into public.prof_session_days (
  year_id, name, sort_order, status, deleted_at, purge_after
)
values (
  (select id from t_fy),
  'PGTAP Legacy Day 1',
  99,
  'published',
  now(),
  now() + interval '7 days'
);

select id into temp t_legacy_day
from public.prof_session_days
where year_id = (select id from t_fy) and name = 'PGTAP Legacy Day 1'
order by created_at desc
limit 1;

-- Capture Gynecology id for uniqueness checks
select id into temp t_gyn
from public.subjects
where year_id = (select id from t_fy) and product_key = 'gynecology'
limit 1;

grant select on t_fy, t_block_n, t_legacy_day, t_gyn to anon, authenticated;

-- Replay migration §0 ensure (idempotent excerpt)
update public.subjects s
set
  product_key = v.product_key,
  name = v.canonical_name,
  sort_order = v.sort_order,
  updated_at = now()
from public.years y
join (
  values
    ('medicine', 'Medicine', 1),
    ('surgery', 'Surgery', 2),
    ('gynecology', 'Gynecology', 3),
    ('pediatrics', 'Pediatrics', 4)
) as v(product_key, canonical_name, sort_order) on true
where s.year_id = y.id
  and y.year_number = 5
  and lower(btrim(s.name)) = lower(v.canonical_name)
  and s.product_key is null
  and not exists (
    select 1 from public.subjects other
    where other.year_id = s.year_id and other.product_key = v.product_key
  );

insert into public.subjects (year_id, name, sort_order, product_key)
select y.id, v.canonical_name, v.sort_order, v.product_key
from public.years y
join (
  values
    ('medicine', 'Medicine', 1),
    ('surgery', 'Surgery', 2),
    ('gynecology', 'Gynecology', 3),
    ('pediatrics', 'Pediatrics', 4)
) as v(product_key, canonical_name, sort_order) on true
where y.year_number = 5
  and not exists (
    select 1 from public.subjects s
    where s.year_id = y.id and s.product_key = v.product_key
  );

    -- Soft-delete any remaining live year-level orphans (migration §2 behavior)
-- (ensure never assigns subject_id to these rows)
update public.prof_session_days
set
  deleted_at = coalesce(deleted_at, now()),
  purge_after = coalesce(purge_after, now() + interval '7 days'),
  updated_at = now()
where subject_id is null
  and deleted_at is null;

select is(
  (
    select count(*)::int
    from public.subjects
    where year_id = (select id from t_fy)
      and product_key in ('medicine', 'surgery', 'gynecology', 'pediatrics')
  ),
  4,
  'exactly four Final-Year product_keys'
);

select is(
  (
    select array_agg(product_key order by product_key)
    from public.subjects
    where year_id = (select id from t_fy)
      and product_key in ('medicine', 'surgery', 'gynecology', 'pediatrics')
  ),
  array['gynecology', 'medicine', 'pediatrics', 'surgery']::text[],
  'product_keys are the four clinical subjects'
);

select is(
  (
    select count(*)::int
    from public.subjects
    where year_id = (select id from t_fy) and product_key = 'gynecology'
  ),
  1,
  'no duplicate gynecology product subject'
);

select is(
  (select id from public.subjects where year_id = (select id from t_fy) and product_key = 'gynecology'),
  (select id from t_gyn),
  'existing Gynecology UUID preserved'
);

select ok(
  exists (
    select 1 from public.subjects
    where year_id = (select id from t_fy) and name = 'Medicine I' and product_key is null
  ),
  'departmental Medicine I not remapped to medicine'
);

select ok(
  exists (
    select 1 from public.subjects
    where year_id = (select id from t_fy) and name = 'Surgery I' and product_key is null
  ),
  'departmental Surgery I not remapped to surgery'
);

select ok(
  (
    select subject_id is null and deleted_at is not null
    from public.prof_session_days
    where id = (select id from t_legacy_day)
  ),
  'legacy Day remains soft-deleted with null subject_id (not mapped)'
);

select is(
  (
    select count(*)::int
    from public.prof_session_days
    where subject_id in (
      select id from public.subjects
      where year_id = (select id from t_fy)
        and product_key in ('medicine', 'surgery', 'gynecology', 'pediatrics')
    )
    and name = 'PGTAP Legacy Day 1'
  ),
  0,
  'legacy Day was not attached under any Final-Year product subject'
);

-- Idempotent second apply of ensure
insert into public.subjects (year_id, name, sort_order, product_key)
select y.id, v.canonical_name, v.sort_order, v.product_key
from public.years y
join (
  values
    ('medicine', 'Medicine', 1),
    ('surgery', 'Surgery', 2),
    ('gynecology', 'Gynecology', 3),
    ('pediatrics', 'Pediatrics', 4)
) as v(product_key, canonical_name, sort_order) on true
where y.year_number = 5
  and not exists (
    select 1 from public.subjects s
    where s.year_id = y.id and s.product_key = v.product_key
  );

select is(
  (
    select count(*)::int
    from public.subjects
    where year_id = (select id from t_fy)
      and product_key in ('medicine', 'surgery', 'gynecology', 'pediatrics')
  ),
  4,
  'ensure is idempotent (still exactly four)'
);

select ok(
  (select n from t_block_n) >= 12,
  'Blocks 1–12 product subjects present in curriculum'
);

-- Tree returns four FY subjects for a subscribed Final Year student
select test_helpers.make_admin('FY PS Admin') as id into temp t_admin;
select test_helpers.make_student((select id from t_fy), 'FY PS Paid') as id into temp t_paid;
select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc02'
where id = (select id from t_admin);

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_paid),
  (select id from t_plan),
  (select id from t_fy),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

grant select on t_admin, t_paid, t_plan to anon, authenticated;
select test_helpers.as_user((select id from t_paid));

select is(
  jsonb_array_length(
    public.get_academic_tree('library')->'prof_session'->'subjects'
  ),
  4,
  'prof_session tree exposes four Final-Year subjects'
);

select is(
  (
    select count(*)::int
    from jsonb_array_elements(
      public.get_academic_tree('library')->'prof_session'->'subjects'
    ) subj
    where subj->>'product_key' in ('medicine', 'surgery', 'gynecology', 'pediatrics')
  ),
  4,
  'tree subjects carry the four product_keys'
);

select is(
  (public.get_academic_tree('library')->'prof_session'->>'locked')::boolean,
  false,
  'paid Final Year student has unlocked prof_session'
);

select * from finish();
rollback;
