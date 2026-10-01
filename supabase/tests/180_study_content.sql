-- Study content: materials kinds, signed-object authorize, test prep, pearls.
begin;
select plan(39);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Study Student') as id
  into temp t_student;
select test_helpers.make_admin('Study Main') as id into temp t_admin;
select test_helpers.make_limited_admin('Study Mats', array['manage_materials']) as id
  into temp t_mats;
select test_helpers.make_limited_admin('Study Pub', array['publish_tests']) as id
  into temp t_pub;
select test_helpers.make_limited_admin('Study Zero', '{}') as id into temp t_zero;

select test_helpers.as_user((select id from t_admin));
select public.set_admin_year_assignments(
  (select id from t_mats),
  array[(select year_id from curriculum)]
);
select test_helpers.as_runner();

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

insert into public.material_folders (id, year_id, name, entitlement)
values (
  '11111111-1111-1111-1111-111111111111'::uuid,
  (select year_id from curriculum),
  'Study Free Folder',
  'free'
);
insert into public.material_folders (id, year_id, name, entitlement)
values (
  '22222222-2222-2222-2222-222222222222'::uuid,
  (select year_id from curriculum),
  'Study Paid Folder',
  'free'
);

insert into public.materials (id, folder_id, title, drive_url, kind, status)
values (
  '33333333-3333-3333-3333-333333333333'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Drive note',
  'https://drive.google.com/file/d/study-free',
  'drive',
  'published'
);

insert into public.materials (
  id, folder_id, title, kind, status, r2_object_key, file_type
) values (
  '44444444-4444-4444-4444-444444444444'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Free PDF',
  'pdf',
  'published',
  'study-content/tenant/admin/free-pdf',
  'pdf'
);

insert into public.materials (
  id, folder_id, title, kind, status, body_text, file_type
) values (
  '55555555-5555-5555-5555-555555555555'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Free guideline',
  'guideline',
  'published',
  '# Read this chapter first',
  'guideline'
);

insert into public.materials (
  id, folder_id, title, kind, status, r2_object_key, file_type
) values (
  '66666666-6666-6666-6666-666666666666'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'Paid PDF',
  'pdf',
  'published',
  'study-content/tenant/admin/paid-pdf',
  'pdf'
);

insert into public.materials (
  id, folder_id, title, kind, status, body_text, file_type
) values (
  '77777777-7777-7777-7777-777777777777'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Draft guideline',
  'guideline',
  'draft',
  'Secret draft body',
  'guideline'
);

insert into public.pearl_points (
  id, prompt, answer, explanation, year_id, subject_id, status, entitlement
) values (
  '88888888-8888-8888-8888-888888888888'::uuid,
  'Which nerve supplies the deltoid muscle?',
  'Axillary nerve',
  'Also supplies teres minor.',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'published',
  'free'
);

insert into public.pearl_points (
  id, prompt, answer, explanation, year_id, subject_id, status, entitlement
) values (
  '99999999-9999-9999-9999-999999999999'::uuid,
  'Paid pearl prompt',
  'Paid pearl answer',
  'Paid pearl explanation',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'published',
  'free'
);

insert into public.pearl_points (
  id, prompt, answer, year_id, subject_id, status
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  'Draft pearl',
  'Hidden answer',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'draft'
);

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 1
) as id into temp t_live;

insert into public.tests (
  id, title, year_id, status, opens_at, closes_at, duration_minutes, min_questions
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid,
  'Upcoming study test',
  (select year_id from curriculum),
  'published',
  now() + interval '2 days',
  now() + interval '3 days',
  60,
  1
);
insert into public.test_audiences (test_id, year_id)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid,
  (select year_id from curriculum)
);

insert into public.tests (
  id, title, year_id, status, opens_at, closes_at, duration_minutes, min_questions
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'::uuid,
  'Neither draft test',
  (select year_id from curriculum),
  'draft',
  now() + interval '1 day',
  now() + interval '2 days',
  60,
  1
);

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 1
) as id into temp t_history;

grant select on curriculum, t_student, t_admin, t_mats, t_pub, t_zero, t_std,
  t_live, t_history
  to anon, authenticated;

------------------------------------------------------------------
-- Drive compatibility + secret columns
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select is(
  public.open_material('33333333-3333-3333-3333-333333333333'::uuid),
  'https://drive.google.com/file/d/study-free',
  'existing Drive materials still open via open_material'
);

select throws_ok(
  $$select public.open_material('44444444-4444-4444-4444-444444444444'::uuid)$$,
  'material_access_denied',
  'open_material refuses PDF kind'
);

select ok(
  not has_column_privilege('authenticated', 'public.materials', 'drive_url', 'select')
  and not has_column_privilege('authenticated', 'public.materials', 'body_text', 'select')
  and not has_column_privilege('authenticated', 'public.materials', 'r2_object_key', 'select'),
  'students cannot SELECT drive_url, body_text, or R2 keys'
);

select ok(
  not has_column_privilege('authenticated', 'public.pearl_points', 'answer', 'select')
  and not has_column_privilege('authenticated', 'public.pearl_points', 'explanation', 'select'),
  'students cannot SELECT pearl answers'
);

select is(
  (select count(*)::int from public.materials where id = '77777777-7777-7777-7777-777777777777'::uuid),
  0,
  'draft materials are hidden from student catalog'
);

select is(
  (select count(*)::int from public.pearl_points where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid),
  0,
  'draft pearls are hidden from student catalog'
);

------------------------------------------------------------------
-- Free PDF / guideline vs paid folder lock
------------------------------------------------------------------
select is(
  (public.open_study_item('55555555-5555-5555-5555-555555555555'::uuid) ->> 'body_text'),
  '# Read this chapter first',
  'entitled student receives guideline body via open_study_item'
);

select is(
  (public.open_study_item('44444444-4444-4444-4444-444444444444'::uuid) ->> 'has_pdf'),
  'true',
  'entitled student receives PDF catalog metadata without the object key'
);

select is(
  (public.open_study_item('44444444-4444-4444-4444-444444444444'::uuid) ? 'r2_object_key'),
  false,
  'open_study_item does not include r2_object_key'
);

select is(
  public.authorize_study_object('44444444-4444-4444-4444-444444444444'::uuid),
  'study-content/tenant/admin/free-pdf',
  'entitled student may authorize a free-folder PDF key'
);

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'materials_folder',
  '22222222-2222-2222-2222-222222222222'::uuid,
  'any_subscription'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.authorize_study_object('66666666-6666-6666-6666-666666666666'::uuid)$$,
  'study_object_denied',
  'free student cannot authorize a paid-folder PDF'
);

select throws_ok(
  $$select public.open_study_item('66666666-6666-6666-6666-666666666666'::uuid)$$,
  'material_access_denied',
  'free student cannot open paid-folder PDF metadata body path'
);

select is(
  (select count(*)::int from public.materials where id = '66666666-6666-6666-6666-666666666666'::uuid),
  1,
  'paid PDF remains catalog-visible when the folder is viewable'
);

------------------------------------------------------------------
-- Pearls: free vs paid, direct RPC
------------------------------------------------------------------
select ok(
  public.can_view_pearl('88888888-8888-8888-8888-888888888888'::uuid)
  and public.can_access_pearl('88888888-8888-8888-8888-888888888888'::uuid),
  'free published pearl is viewable and accessible'
);

select is(
  public.open_pearl('88888888-8888-8888-8888-888888888888'::uuid) ->> 'answer',
  'Axillary nerve',
  'open_pearl returns the reveal payload when entitled'
);

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'pearl_point',
  '99999999-9999-9999-9999-999999999999'::uuid,
  'any_subscription'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_view_pearl('99999999-9999-9999-9999-999999999999'::uuid)
  and not public.can_access_pearl('99999999-9999-9999-9999-999999999999'::uuid),
  'paid pearl is catalog-visible and content-locked for free students'
);

select throws_ok(
  $$select public.open_pearl('99999999-9999-9999-9999-999999999999'::uuid)$$,
  'pearl_access_denied',
  'direct open_pearl is denied without entitlement'
);

select is(
  (select count(*)::int from public.pearl_points where id = '99999999-9999-9999-9999-999999999999'::uuid),
  1,
  'locked paid pearl prompt remains listed without granting the answer column'
);

------------------------------------------------------------------
-- Test audience + prep guidelines + upcoming catalog
------------------------------------------------------------------
select test_helpers.as_user((select id from t_pub));
select throws_ok(
  format(
    'select public.upsert_test_prep_guidelines(%L, %L)',
    (select id from t_live),
    'should freeze'
  ),
  'published test config is frozen (docs/test-rules.md)',
  'prep guidelines cannot change after publish'
);

select test_helpers.as_runner();
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, min_questions
  ) values (
    'Draft prep holder',
    (select year_id from curriculum),
    'draft',
    now() + interval '1 day',
    now() + interval '2 days',
    60,
    1
  )
  returning id
)
select id into temp t_draft from ins;

grant select on t_draft to authenticated;

select test_helpers.as_user((select id from t_pub));
select public.upsert_test_prep_guidelines(
  (select id from t_draft),
  'Prep while draft.'
);
select public.set_resource_entitlement(
  'test',
  (select id from t_draft),
  'any_subscription'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_view_test('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid)
  and public.can_access_test('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid),
  'upcoming published free test is in the catalog immediately'
);

select ok(
  not public.can_view_test('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'::uuid),
  'draft (Neither) tests are not in the student catalog'
);

select throws_ok(
  format(
    'select public.get_test_prep_guidelines(%L)',
    (select id from t_draft)
  ),
  'test_prep_denied',
  'paid draft/unpublished test prep is not readable by free students'
);

select test_helpers.as_runner();
-- Attach prep to the upcoming free published test as runner (status published
-- would freeze the trigger). Use session_replication_role for this fixture only.
set local session_replication_role = replica;
insert into public.test_prep_guidelines (test_id, body_text)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid,
  'Upcoming prep remains attached.'
);
reset session_replication_role;

select test_helpers.as_user((select id from t_student));
select is(
  public.get_test_prep_guidelines('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid),
  'Upcoming prep remains attached.',
  'entitled student can read prep before the window opens'
);

select ok(
  exists (
    select 1 from public.accessible_test_prep()
    where test_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid
  ),
  'accessible_test_prep lists entitled upcoming prep'
);

------------------------------------------------------------------
-- History: submitted attempt leaves active list; prep relationship remains
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.start_attempt(
  (select id from t_history),
  'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid
) as payload into temp t_start_hist;
grant select on t_start_hist to authenticated;

select public.submit_attempt(
  ((select payload from t_start_hist) ->> 'attempt_id')::uuid,
  'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid
);

select is(
  (
    select state from public.test_attempts
    where id = ((select payload from t_start_hist) ->> 'attempt_id')::uuid
  ),
  'submitted',
  'history fixture submitted'
);

select ok(
  public.can_access_test((select id from t_history)),
  'submitted free test remains entitled so attached prep can still be fetched'
);

------------------------------------------------------------------
-- Paid student retains free resources; live sub unlocks paid pearl
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.activate_subscription((select id from t_student), (select id from t_std));

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_pearl('88888888-8888-8888-8888-888888888888'::uuid)
  and public.can_access_pearl('99999999-9999-9999-9999-999999999999'::uuid),
  'live subscription keeps free pearls and unlocks paid pearls'
);

select is(
  public.authorize_study_object('66666666-6666-6666-6666-666666666666'::uuid),
  'study-content/tenant/admin/paid-pdf',
  'live subscription authorizes paid-folder PDF'
);

------------------------------------------------------------------
-- Admin R2 allocate + least privilege
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.allocate_study_object_key()$$,
  'admin only',
  'students cannot allocate study-content keys'
);

select test_helpers.as_user((select id from t_zero));
select throws_ok(
  $$select public.allocate_study_object_key()$$,
  'permission_denied',
  'zero-permission admin cannot allocate study-content keys'
);

select test_helpers.as_user((select id from t_mats));
select ok(
  public.allocate_study_object_key() like 'study-content/%',
  'manage_materials can allocate a study-content object key'
);

select ok(
  public.authorize_study_object('66666666-6666-6666-6666-666666666666'::uuid)
    = 'study-content/tenant/admin/paid-pdf',
  'manage_materials can authorize PDF keys for preview'
);

select is(
  public.open_pearl('99999999-9999-9999-9999-999999999999'::uuid) ->> 'answer',
  'Paid pearl answer',
  'manage_materials can preview pearl answers'
);

select test_helpers.as_user((select id from t_zero));
select throws_ok(
  $$select public.open_pearl('88888888-8888-8888-8888-888888888888'::uuid)$$,
  'pearl_access_denied',
  'zero-permission admin without student enrollment cannot open pearls'
);

select throws_ok(
  $$select public.authorize_study_object('44444444-4444-4444-4444-444444444444'::uuid)$$,
  'study_object_denied',
  'zero-permission admin cannot authorize student PDFs'
);

------------------------------------------------------------------
-- manage_materials may set folder/pearl entitlement
------------------------------------------------------------------
select test_helpers.as_user((select id from t_mats));
select lives_ok(
  $$select public.set_resource_entitlement(
    'pearl_point',
    '88888888-8888-8888-8888-888888888888',
    'free'
  )$$,
  'manage_materials can set pearl entitlement'
);

------------------------------------------------------------------
-- App create-folder workflow: INSERT free, then set paid via RPC
------------------------------------------------------------------
select test_helpers.as_user((select id from t_mats));
select throws_ok(
  $$insert into public.material_folders (year_id, name, library_type, entitlement)
    values (
      (select year_id from curriculum),
      'Paid Direct Insert Must Fail',
      'notes',
      'any_subscription'
    )$$,
  'entitlement changes require set_resource_entitlement()',
  'direct INSERT of any_subscription folder is blocked'
);

select lives_ok(
  $$
  with created as (
    insert into public.material_folders (year_id, name, library_type, entitlement)
    values (
      (select year_id from curriculum),
      'Paid Via RPC Workflow',
      'notes',
      'free'
    )
    returning id
  )
  select public.set_resource_entitlement(
    'materials_folder',
    (select id from created),
    'any_subscription'
  )
  $$,
  'create folder as free then set_resource_entitlement to any_subscription'
);

select is(
  (
    select entitlement from public.material_folders
    where name = 'Paid Via RPC Workflow'
  ),
  'any_subscription',
  'paid folder entitlement is any_subscription after RPC workflow'
);

select finish();
rollback;
