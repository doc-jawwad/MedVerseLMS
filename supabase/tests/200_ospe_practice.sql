-- OSPE Practice stations: RLS, authorize, reveal, entitlement, practice_progress.
begin;
select plan(42);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2;
with ins as (
  insert into public.subjects (year_id, name)
  values ((select id from t_year2), 'OSPE_Y2_' || gen_random_uuid()::text)
  returning id
)
select id into temp t_subject2 from ins;

select test_helpers.make_student((select year_id from curriculum), 'Ospe Free') as id
  into temp t_free;
select test_helpers.make_student((select year_id from curriculum), 'Ospe Paid') as id
  into temp t_paid;
select test_helpers.make_student((select id from t_year2), 'Ospe WrongClass') as id
  into temp t_wrong;
select test_helpers.make_admin('Ospe Main') as id into temp t_main;
select test_helpers.make_limited_admin('Ospe Mats Assigned', array['manage_materials']) as id
  into temp t_mats_ok;
select test_helpers.make_limited_admin('Ospe Mats Unassigned', array['manage_materials']) as id
  into temp t_mats_no;
select test_helpers.make_limited_admin('Ospe Zero', '{}') as id into temp t_zero;

select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

grant select on curriculum, t_year2, t_subject2, t_free, t_paid, t_wrong,
  t_main, t_mats_ok, t_mats_no, t_zero, t_plan
  to anon, authenticated;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
where id = (select id from t_free);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
where id = (select id from t_wrong);

-- Bind paid student to a live subscription
insert into public.subscriptions (
  student_id, plan_id, status, starts_at, ends_at, year_id, grace_days, paid_access_mode
) values (
  (select id from t_paid),
  (select id from t_plan),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  (select year_id from curriculum),
  0,
  'all_entitled'
);

-- Assign limited materials admin to curriculum year only
select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_mats_ok),
  array[(select year_id from curriculum)]
);

select test_helpers.as_runner();

-- Stations (insert free; mutate entitlement via RPC)
insert into public.ospe_stations (
  id, title, answer, year_id, subject_id, status, entitlement,
  r2_object_key, r2_content_type, r2_byte_size, sort_order, created_by
) values
(
  '11111111-1111-1111-1111-111111111101'::uuid,
  'Free station',
  'Free answer',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'published',
  'free',
  'study-content/tenant/admin/ospe-free',
  'image/jpeg',
  1024,
  1,
  (select id from t_main)
),
(
  '11111111-1111-1111-1111-111111111102'::uuid,
  'Any-sub station',
  'Any-sub answer',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'published',
  'free',
  'study-content/tenant/admin/ospe-any',
  'image/png',
  2048,
  2,
  (select id from t_main)
),
(
  '11111111-1111-1111-1111-111111111103'::uuid,
  'Plan station',
  'Plan answer',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'published',
  'free',
  'study-content/tenant/admin/ospe-plan',
  'image/webp',
  4096,
  3,
  (select id from t_main)
),
(
  '11111111-1111-1111-1111-111111111104'::uuid,
  'Draft station',
  'Draft answer',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'draft',
  'free',
  'study-content/tenant/admin/ospe-draft',
  'image/jpeg',
  512,
  4,
  (select id from t_main)
),
(
  '11111111-1111-1111-1111-111111111105'::uuid,
  'Year2 station',
  'Year2 answer',
  (select id from t_year2),
  (select id from t_subject2),
  'published',
  'free',
  'study-content/tenant/admin/ospe-y2',
  'image/jpeg',
  768,
  1,
  (select id from t_main)
);

select test_helpers.as_user((select id from t_main));
select public.set_resource_entitlement(
  'ospe_station',
  '11111111-1111-1111-1111-111111111102'::uuid,
  'any_subscription'
);
select public.set_resource_entitlement(
  'ospe_station',
  '11111111-1111-1111-1111-111111111103'::uuid,
  'plan',
  (select id from t_plan)
);

------------------------------------------------------------------
-- Column privileges / catalog metadata
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);

select ok(
  not has_column_privilege('authenticated', 'public.ospe_stations', 'answer', 'select')
  and not has_column_privilege('authenticated', 'public.ospe_stations', 'r2_object_key', 'select')
  and not has_column_privilege('authenticated', 'public.ospe_stations', 'r2_content_type', 'select')
  and not has_column_privilege('authenticated', 'public.ospe_stations', 'r2_byte_size', 'select')
  and not has_column_privilege('authenticated', 'public.ospe_stations', 'created_by', 'select'),
  '1 student cannot SELECT answer / r2_* / created_by'
);

select ok(
  has_column_privilege('authenticated', 'public.ospe_stations', 'title', 'select')
  and has_column_privilege('authenticated', 'public.ospe_stations', 'entitlement', 'select')
  and has_column_privilege('authenticated', 'public.ospe_stations', 'sort_order', 'select'),
  '2 catalog columns include metadata only'
);

select is(
  (select count(*)::int from public.ospe_stations
   where id = '11111111-1111-1111-1111-111111111101'::uuid),
  1,
  '3 free published station is catalog-visible'
);

select is(
  (select count(*)::int from public.ospe_stations
   where id = '11111111-1111-1111-1111-111111111104'::uuid),
  0,
  '4 draft station is not catalog-visible to students'
);

select ok(
  public.can_view_ospe_station('11111111-1111-1111-1111-111111111101'::uuid)
  and public.can_access_ospe_station('11111111-1111-1111-1111-111111111101'::uuid),
  '5 free station viewable and accessible'
);

select is(
  public.open_ospe_station('11111111-1111-1111-1111-111111111101'::uuid) ->> 'answer',
  'Free answer',
  '6 entitled open_ospe_station returns answer'
);

select ok(
  not (public.open_ospe_station('11111111-1111-1111-1111-111111111101'::uuid) ? 'r2_object_key'),
  '7 open_ospe_station never returns r2_object_key'
);

select is(
  public.authorize_ospe_station_object('11111111-1111-1111-1111-111111111101'::uuid),
  'study-content/tenant/admin/ospe-free',
  '8 entitled image authorization allowed'
);

------------------------------------------------------------------
-- Locked any_subscription / plan
------------------------------------------------------------------
select ok(
  public.can_view_ospe_station('11111111-1111-1111-1111-111111111102'::uuid)
  and not public.can_access_ospe_station('11111111-1111-1111-1111-111111111102'::uuid),
  '9 any_subscription station catalog-visible but locked for free student'
);

select throws_ok(
  $$select public.open_ospe_station('11111111-1111-1111-1111-111111111102'::uuid)$$,
  'ospe_access_denied',
  '10 locked open_ospe_station denied'
);

select throws_ok(
  $$select public.authorize_ospe_station_object('11111111-1111-1111-1111-111111111102'::uuid)$$,
  'ospe_object_denied',
  '11 locked image authorization denied'
);

select ok(
  public.can_view_ospe_station('11111111-1111-1111-1111-111111111103'::uuid)
  and not public.can_access_ospe_station('11111111-1111-1111-1111-111111111103'::uuid),
  '12 plan station locked for free student'
);

select throws_ok(
  $$select public.open_ospe_station('11111111-1111-1111-1111-111111111103'::uuid)$$,
  'ospe_access_denied',
  '13 plan open denied for free student'
);

------------------------------------------------------------------
-- Paid student unlocks any_subscription
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_paid),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid
);

select ok(
  public.can_access_ospe_station('11111111-1111-1111-1111-111111111102'::uuid),
  '14 paid student accesses any_subscription station'
);

select is(
  public.open_ospe_station('11111111-1111-1111-1111-111111111102'::uuid) ->> 'answer',
  'Any-sub answer',
  '15 paid open_ospe_station returns answer only'
);

select is(
  public.authorize_ospe_station_object('11111111-1111-1111-1111-111111111102'::uuid),
  'study-content/tenant/admin/ospe-any',
  '16 paid image authorization allowed'
);

select ok(
  public.can_access_ospe_station('11111111-1111-1111-1111-111111111103'::uuid),
  '17 paid student with matching plan accesses plan station'
);

------------------------------------------------------------------
-- Wrong class
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_wrong),
  'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid
);

select ok(
  not public.can_view_ospe_station('11111111-1111-1111-1111-111111111101'::uuid)
  and not public.can_access_ospe_station('11111111-1111-1111-1111-111111111101'::uuid),
  '18 wrong-class student cannot view/access year-1 station'
);

select is(
  (select count(*)::int from public.ospe_stations
   where id = '11111111-1111-1111-1111-111111111101'::uuid),
  0,
  '19 wrong-class catalog SELECT returns 0 for other-year station'
);

select ok(
  public.can_view_ospe_station('11111111-1111-1111-1111-111111111105'::uuid)
  and public.can_access_ospe_station('11111111-1111-1111-1111-111111111105'::uuid),
  '20 wrong-class student can access own-year free station'
);

------------------------------------------------------------------
-- Draft: students denied; assigned admin allowed
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);

select throws_ok(
  $$select public.open_ospe_station('11111111-1111-1111-1111-111111111104'::uuid)$$,
  'ospe_access_denied',
  '21 student cannot open draft'
);

select throws_ok(
  $$select public.authorize_ospe_station_object('11111111-1111-1111-1111-111111111104'::uuid)$$,
  'ospe_object_denied',
  '22 student cannot authorize draft image'
);

select test_helpers.as_user((select id from t_mats_ok));
select is(
  public.open_ospe_station('11111111-1111-1111-1111-111111111104'::uuid) ->> 'answer',
  'Draft answer',
  '23 assigned limited admin may open draft reveal'
);

select is(
  public.authorize_ospe_station_object('11111111-1111-1111-1111-111111111104'::uuid),
  'study-content/tenant/admin/ospe-draft',
  '24 assigned limited admin may authorize draft image'
);

select is(
  public.get_ospe_station_for_admin('11111111-1111-1111-1111-111111111104'::uuid)
    ->> 'r2_object_key',
  'study-content/tenant/admin/ospe-draft',
  '25 get_ospe_station_for_admin returns object key for assigned admin'
);

select ok(
  (public.get_ospe_station_for_admin('11111111-1111-1111-1111-111111111101'::uuid)
    ->> 'answer') = 'Free answer'
  and (public.get_ospe_station_for_admin('11111111-1111-1111-1111-111111111101'::uuid)
    ->> 'entitlement') = 'free',
  '26 admin payload includes answer and entitlement'
);

------------------------------------------------------------------
-- Unassigned limited admin + zero-permission admin
------------------------------------------------------------------
select test_helpers.as_user((select id from t_mats_no));
select throws_ok(
  $$select public.get_ospe_station_for_admin('11111111-1111-1111-1111-111111111101'::uuid)$$,
  'permission_denied',
  '27 unassigned limited admin denied get_ospe_station_for_admin'
);

select throws_ok(
  $$select public.open_ospe_station('11111111-1111-1111-1111-111111111104'::uuid)$$,
  'ospe_access_denied',
  '28 unassigned limited admin cannot open draft'
);

select throws_ok(
  $$select public.authorize_ospe_station_object('11111111-1111-1111-1111-111111111104'::uuid)$$,
  'ospe_object_denied',
  '29 unassigned limited admin cannot authorize draft image'
);

select is(
  (select count(*)::int from public.ospe_stations
   where id = '11111111-1111-1111-1111-111111111101'::uuid),
  0,
  '30 unassigned limited admin SELECT returns 0 (year-scoped RLS)'
);

select test_helpers.as_user((select id from t_zero));
select throws_ok(
  $$select public.get_ospe_station_for_admin('11111111-1111-1111-1111-111111111101'::uuid)$$,
  'permission_denied',
  '31 zero-permission admin denied get_ospe_station_for_admin'
);

------------------------------------------------------------------
-- Admin CRUD authorization
------------------------------------------------------------------
select test_helpers.as_user((select id from t_mats_ok));
select lives_ok(
  format(
    $q$
    insert into public.ospe_stations (
      id, title, answer, year_id, subject_id, status,
      r2_object_key, r2_content_type, r2_byte_size, sort_order, created_by
    ) values (
      '11111111-1111-1111-1111-111111111106'::uuid,
      'Admin created',
      'Admin answer',
      %L::uuid,
      %L::uuid,
      'draft',
      'study-content/tenant/admin/ospe-created',
      'image/jpeg',
      100,
      10,
      %L::uuid
    )
    $q$,
    (select year_id from curriculum),
    (select subject_id from curriculum),
    (select id from t_mats_ok)
  ),
  '32 assigned limited admin can INSERT station'
);

select lives_ok(
  $$update public.ospe_stations
    set title = 'Admin created updated'
    where id = '11111111-1111-1111-1111-111111111106'::uuid$$,
  '33 assigned limited admin can UPDATE station'
);

select lives_ok(
  $$delete from public.ospe_stations
    where id = '11111111-1111-1111-1111-111111111106'::uuid$$,
  '34 assigned limited admin can DELETE station'
);

select test_helpers.as_user((select id from t_mats_no));
select throws_ok(
  format(
    $q$
    insert into public.ospe_stations (
      title, answer, year_id, subject_id, status,
      r2_object_key, r2_content_type, r2_byte_size
    ) values (
      'Should fail',
      'Nope',
      %L::uuid,
      %L::uuid,
      'draft',
      'study-content/tenant/admin/ospe-fail',
      'image/jpeg',
      100
    )
    $q$,
    (select year_id from curriculum),
    (select subject_id from curriculum)
  ),
  'new row violates row-level security policy for table "ospe_stations"',
  '35 unassigned limited admin INSERT denied by RLS'
);

select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);
select throws_ok(
  format(
    $q$
    insert into public.ospe_stations (
      title, answer, year_id, subject_id, status,
      r2_object_key, r2_content_type, r2_byte_size
    ) values (
      'Student insert',
      'Nope',
      %L::uuid,
      %L::uuid,
      'published',
      'study-content/tenant/admin/ospe-student',
      'image/jpeg',
      100
    )
    $q$,
    (select year_id from curriculum),
    (select subject_id from curriculum)
  ),
  'new row violates row-level security policy for table "ospe_stations"',
  '36 student INSERT denied'
);

------------------------------------------------------------------
-- Entitlement RPC + practice_progress (no test_attempts)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.set_resource_entitlement(
    'ospe_station',
    '11111111-1111-1111-1111-111111111101'::uuid,
    'any_subscription'
  )$$,
  '37 set_resource_entitlement accepts ospe_station'
);

select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);
select throws_ok(
  $$select public.set_practice_item_state(
    'ospe',
    '11111111-1111-1111-1111-111111111101'::uuid,
    'done'
  )$$,
  'practice_access_denied',
  '38 locked ospe practice_progress denied'
);

-- Restore free entitlement for progress success path
select test_helpers.as_user((select id from t_main));
select public.set_resource_entitlement(
  'ospe_station',
  '11111111-1111-1111-1111-111111111101'::uuid,
  'free'
);

select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);

select lives_ok(
  $$select public.set_practice_item_state(
    'ospe',
    '11111111-1111-1111-1111-111111111101'::uuid,
    'done'
  )$$,
  '39 entitled ospe reveal may set practice_progress done'
);

select is(
  (select state from public.practice_progress
   where student_id = (select id from t_free)
     and item_kind = 'ospe'
     and item_id = '11111111-1111-1111-1111-111111111101'::uuid),
  'done',
  '40 reveal sets ospe practice_progress state=done'
);

select is(
  (select count(*)::int from public.test_attempts
   where student_id = (select id from t_free)),
  0,
  '41 reveal creates no test_attempts row'
);

-- Reset includes ospe rows for the subject
select public.reset_practice_done_to_remaining((select subject_id from curriculum));
select is(
  (select state from public.practice_progress
   where student_id = (select id from t_free)
     and item_kind = 'ospe'
     and item_id = '11111111-1111-1111-1111-111111111101'::uuid),
  'remaining',
  '42 reset_practice_done_to_remaining includes ospe'
);

select * from finish();
rollback;
