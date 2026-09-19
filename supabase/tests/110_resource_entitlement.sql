-- Step 8D resource entitlement / restrictions. Transaction-scoped fixtures.

begin;
select plan(50);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Ent Student') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'Ent Blocked') as id
  into temp t_blocked;
select test_helpers.make_admin('Ent Admin') as id into temp t_admin;
select test_helpers.make_limited_admin('Ent Grantor', array['grant_resource_access']) as id
  into temp t_grantor;
select test_helpers.make_limited_admin('Ent Academic', array['publish_tests']) as id
  into temp t_publisher;
select test_helpers.make_limited_admin('Ent Zero', '{}') as id
  into temp t_zero;

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_free;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_paid;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_plan;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_grant_test;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_blocked_free;
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_practice_q;
select id as id into temp t_seed_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

with ins as (
  insert into public.material_folders (year_id, name)
  values ((select year_id from curriculum), 'PGTAP free folder')
  returning id
)
select id into temp t_free_folder from ins;
with ins as (
  insert into public.material_folders (year_id, name)
  values ((select year_id from curriculum), 'PGTAP paid folder')
  returning id
)
select id into temp t_paid_folder from ins;
with ins as (
  insert into public.materials (folder_id, title, drive_url)
  values (
    (select id from t_free_folder),
    'Free notes',
    'https://drive.google.com/file/d/pgtap-free'
  )
  returning id
)
select id into temp t_free_mat from ins;
with ins as (
  insert into public.materials (folder_id, title, drive_url)
  values (
    (select id from t_paid_folder),
    'Paid notes',
    'https://drive.google.com/file/d/pgtap-paid'
  )
  returning id
)
select id into temp t_paid_mat from ins;

grant select on curriculum, t_student, t_blocked, t_admin, t_grantor, t_publisher, t_zero,
  t_free, t_paid, t_plan, t_grant_test, t_blocked_free, t_practice_q, t_seed_plan,
  t_free_folder, t_paid_folder, t_free_mat, t_paid_mat
  to anon, authenticated;

------------------------------------------------------------------
-- 17) existing free resources preserve current behavior
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  public.can_view_test((select id from t_free))
  and public.can_access_test((select id from t_free)),
  '1/17 active student + free test → catalog and content allowed'
);
select lives_ok(
  format(
    'select public.start_attempt(%L, %L::uuid)',
    (select id from t_free),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'
  ),
  '1b free test can be started'
);
select ok(
  public.has_practice_access((select subject_id from curriculum)),
  '17b existing free practice subject is usable without a grant'
);
select is(
  (select count(*)::int from public.material_folders where id = (select id from t_free_folder)),
  1,
  '17c free material folder remains catalog-visible'
);
select is(
  public.open_material((select id from t_free_mat)),
  'https://drive.google.com/file/d/pgtap-free',
  '17d free material URL is returned only via open_material'
);

------------------------------------------------------------------
-- 2 / 15 / 16 paid catalog visible, content denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_grantor));
select lives_ok(
  format(
    'select public.set_resource_entitlement(%L, %L, %L)',
    'test', (select id from t_paid), 'any_subscription'
  ),
  '11 authorized admin can change test entitlement'
);
select lives_ok(
  format(
    'select public.set_resource_entitlement(%L, %L, %L, %L::uuid)',
    'test', (select id from t_plan), 'plan',
    (select id from t_seed_plan)
  ),
  '5a authorized admin can set plan entitlement'
);
select lives_ok(
  format(
    'select public.set_resource_entitlement(%L, %L, %L)',
    'materials_folder', (select id from t_paid_folder), 'any_subscription'
  ),
  '11b authorized admin can change folder entitlement'
);
select lives_ok(
  format(
    'select public.set_resource_entitlement(%L, %L, %L)',
    'practice_subject', (select subject_id from curriculum), 'any_subscription'
  ),
  '11c authorized admin can change practice entitlement'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_view_test((select id from t_paid))
  and not public.can_access_test((select id from t_paid)),
  '2 active student + paid test + no subscription → denied but catalog visible'
);
select is(
  (select count(*)::int from public.tests where id = (select id from t_paid)),
  1,
  '2b paid test row is listed under can_view_test RLS'
);
select throws_ok(
  format(
    'select public.start_attempt(%L, %L::uuid)',
    (select id from t_paid),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002'
  ),
  'test_access_denied',
  '15 paid test cannot be started without entitlement'
);
select is(
  (select count(*)::int from public.questions),
  0,
  '16a student still cannot SELECT question rows for a paid test'
);
select is(
  (select count(*)::int from public.test_questions where test_id = (select id from t_paid)),
  0,
  '16b student cannot fetch the paid test question payload via test_questions'
);
select ok(
  public.can_view_test((select id from t_plan))
  and not public.can_access_test((select id from t_plan)),
  '5 active student + plan resource without subscription → denied'
);
select ok(
  public.can_view_material_folder((select id from t_paid_folder))
  and not public.can_access_material_folder((select id from t_paid_folder)),
  '2c paid folder is catalog-visible but not entitled'
);
select throws_ok(
  format('select public.open_material(%L)', (select id from t_paid_mat)),
  'material_access_denied',
  '14 student cannot retrieve protected material URL without entitlement'
);
select throws_ok(
  format('select drive_url from public.materials where id = %L', (select id from t_paid_mat)),
  '42501',
  'permission denied for table materials',
  '14b direct SELECT of materials.drive_url is revoked for authenticated'
);
select is(
  (select title from public.materials where id = (select id from t_free_mat)),
  'Free notes',
  '14c student can still SELECT material metadata without drive_url'
);
select ok(
  public.can_view_practice_subject((select subject_id from curriculum))
  and not public.has_practice_access((select subject_id from curriculum)),
  '2d paid practice subject remains listed/locked'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(%L, %L, 1)',
    'subject', (select subject_id from curriculum)
  ),
  'practice_access_denied',
  '16c paid practice question payload cannot be fetched without entitlement'
);

------------------------------------------------------------------
-- 3 / 12 grant allows paid content
------------------------------------------------------------------
select test_helpers.as_user((select id from t_grantor));
select lives_ok(
  format(
    'select public.set_resource_entitlement(%L, %L, %L)',
    'test', (select id from t_grant_test), 'any_subscription'
  ),
  'paid entitlement on grant-target test'
);
select lives_ok(
  format(
    'select public.grant_access(%L, %L, null, %L)',
    (select id from t_student), 'test', (select id from t_grant_test)
  ),
  '12 authorized grant works'
);
select public.grant_access(
  (select id from t_blocked), 'test', null, (select id from t_grant_test), null
) as id into temp t_blocked_grant;
grant select on t_blocked_grant to authenticated;

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_grant_test)),
  '3 active student + paid resource + individual grant → allowed'
);
select lives_ok(
  format(
    'select public.start_attempt(%L, %L::uuid)',
    (select id from t_grant_test),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003'
  ),
  '3b granted paid test can be started'
);

------------------------------------------------------------------
-- 4 / 13 restriction overrides grant
------------------------------------------------------------------
select test_helpers.as_user((select id from t_grantor));
select public.restrict_access(
  (select id from t_student), 'test', null, (select id from t_grant_test), null
) as id into temp t_restriction;
grant select on t_restriction to authenticated;

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_view_test((select id from t_grant_test))
  and not public.can_access_test((select id from t_grant_test)),
  '4/13 restriction denies even with grant; catalog still visible'
);
select is(
  (select count(*)::int from public.access_restrictions where id = (select id from t_restriction)),
  1,
  '4b restriction is visible to the affected student'
);

select test_helpers.as_user((select id from t_grantor));
select lives_ok(
  format('select public.unrestrict_access(%L)', (select id from t_restriction)),
  'authorized unrestrict works'
);
select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_grant_test)),
  '13b unrestrict restores grant-based access'
);

------------------------------------------------------------------
-- 6 / 7 blocked account wins over free and grant
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_blocked), 'restricted'),
  'admin can block the student account'
);
select test_helpers.as_user((select id from t_blocked));
select ok(
  (not public.can_view_test((select id from t_free)))
  and (not public.can_access_test((select id from t_free))),
  '6 blocked account + free resource → denied'
);
select ok(
  (not public.can_access_test((select id from t_grant_test))),
  '7 blocked account + grant → denied'
);
select throws_ok(
  format(
    'select public.start_attempt(%L, %L::uuid)',
    (select id from t_blocked_free),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004'
  ),
  'session_superseded',
  '6b blocked account cannot start a free test'
);

------------------------------------------------------------------
-- 8 / 9 student cannot create restriction or grant
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'insert into public.access_restrictions (student_id, resource_kind, subject_id) values (%L, ''practice_subject'', %L)',
    (select id from t_student),
    (select subject_id from curriculum)
  ),
  'new row violates row-level security policy for table "access_restrictions"',
  '8 student cannot create restriction'
);
select throws_ok(
  format(
    'insert into public.access_grants (student_id, grant_type, subject_id) values (%L, ''practice_subject'', %L)',
    (select id from t_student),
    (select subject_id from curriculum)
  ),
  'new row violates row-level security policy for table "access_grants"',
  '9 student cannot create grant'
);
select throws_ok(
  format(
    'select public.restrict_access(%L, ''practice_subject'', %L)',
    (select id from t_student),
    (select subject_id from curriculum)
  ),
  'admin only',
  '8b student restrict_access RPC is admin-only'
);
select throws_ok(
  format(
    'select public.grant_access(%L, ''practice_subject'', %L)',
    (select id from t_student),
    (select subject_id from curriculum)
  ),
  'admin only',
  '9b student grant_access RPC is admin-only'
);

------------------------------------------------------------------
-- 10 unauthorized admin cannot change entitlement
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select throws_ok(
  format(
    'select public.set_resource_entitlement(%L, %L, %L)',
    'test', (select id from t_paid), 'free'
  ),
  'permission_denied',
  '10 unauthorized admin cannot change entitlement'
);
select test_helpers.as_user((select id from t_publisher));
select throws_ok(
  format(
    'update public.tests set entitlement = ''free'' where id = %L',
    (select id from t_paid)
  ),
  'entitlement changes require set_resource_entitlement()',
  '10b publish_tests cannot bypass the entitlement RPC'
);
select throws_ok(
  format(
    'select public.restrict_access(%L, ''test'', null, %L)',
    (select id from t_student),
    (select id from t_paid)
  ),
  'permission_denied',
  '10c publish_tests cannot restrict_access'
);

------------------------------------------------------------------
-- 18 search_path / security-definer invariants
------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'has_live_subscription', 'has_live_plan',
        'has_resource_grant', 'has_resource_restriction',
        'resource_entitlement_allows', 'resource_content_allowed',
        'can_view_test', 'can_access_test',
        'can_view_practice_subject', 'has_practice_access',
        'can_view_material_folder', 'can_access_material_folder',
        'accessible_test_ids', 'accessible_folder_ids',
        'open_material', 'set_resource_entitlement',
        'restrict_access', 'unrestrict_access', 'protect_resource_entitlement'
      )
      and p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%public%'
      )
  ),
  18,
  '18 new entitlement SECURITY DEFINER functions set search_path = public'
);
select is(
  (
    select prosecdef and exists (
      select 1 from unnest(p.proconfig) cfg
      where cfg like 'search_path=%public%'
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'protect_resource_entitlement'
  ),
  false,
  '18b entitlement trigger is invoker with search_path=public (not definer)'
);

select test_helpers.as_runner();
select is(
  (
    select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'protect_resource_entitlement'
      and exists (
        select 1 from unnest(p.proconfig) cfg
        where cfg like 'search_path=%public%'
      )
  ),
  1,
  '18c protect_resource_entitlement still pins search_path = public'
);

------------------------------------------------------------------
-- 19 audit behavior
------------------------------------------------------------------
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.audit_logs
    where action = 'resource_entitlement_changed'
      and target_id = (select id from t_paid)
      and actor_id = (select id from t_grantor)),
  1,
  '19 entitlement change is audited'
);
select is(
  (select count(*)::int from public.audit_logs
    where action = 'access_restricted'
      and actor_id = (select id from t_grantor)),
  1,
  '19b restriction is audited'
);
select is(
  (select count(*)::int from public.audit_logs
    where action = 'access_unrestricted'
      and actor_id = (select id from t_grantor)),
  1,
  '19c unrestriction is audited'
);
select is(
  (select count(*)::int from public.audit_logs
    where action = 'access_granted'
      and actor_id = (select id from t_grantor)
      and (details ->> 'test_id') = (select id from t_grant_test)::text
      and (details ->> 'student_id') = (select id from t_student)::text),
  1,
  '19d grant is audited'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.log_audit(''forged_restriction'', ''access_restriction'', %L, ''{}''::jsonb)',
    (select id from t_restriction)
  ),
  'permission denied for function log_audit',
  '19e student cannot insert audit rows'
);

select test_helpers.as_user((select id from t_admin));
select is(
  public.open_material((select id from t_paid_mat)),
  'https://drive.google.com/file/d/pgtap-paid',
  'admin can open a paid material via RPC without a student grant'
);

select ok(
  (not public.has_live_subscription()) and (not public.has_live_plan((select id from t_seed_plan))),
  'student without a subscription has no live subscription or live plan'
);

select * from finish();
rollback;
