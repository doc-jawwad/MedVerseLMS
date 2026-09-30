-- One Liner PDF folders: library_type constraints, year isolation, authorize, highlights.
begin;
select plan(17);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'OL Student A') as id
  into temp t_stu_a;
select test_helpers.make_student((select year_id from curriculum), 'OL Student B') as id
  into temp t_stu_b;
select test_helpers.make_admin('OL Admin') as id into temp t_admin;

select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

-- Second year for class-switch / wrong-year checks
select id into temp t_y2 from public.years where year_number = 2 limit 1;
select test_helpers.make_student((select id from t_y2), 'OL Other Year') as id
  into temp t_other_year;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
where id = (select id from t_stu_a);
update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'
where id = (select id from t_stu_b);
update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'
where id = (select id from t_other_year);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'
where id = (select id from t_admin);

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_stu_a),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_stu_b),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

grant select on curriculum, t_stu_a, t_stu_b, t_other_year, t_admin, t_plan, t_block1, t_y2
  to authenticated;

------------------------------------------------------------------
-- Folder create constraints
------------------------------------------------------------------
select throws_ok(
  $$insert into public.material_folders (year_id, name, library_type, content_surface)
    values ((select year_id from curriculum), 'No Subject', 'one_liner', 'academic')$$,
  '23514',
  null,
  'one_liner folder requires subject_id'
);

select lives_ok(
  $$insert into public.material_folders (
      id, year_id, subject_id, name, library_type, content_surface, entitlement, sort_order
    ) values (
      'b1111111-1111-1111-1111-111111111111'::uuid,
      (select year_id from curriculum),
      (select id from t_block1),
      'Physiology Pearls',
      'one_liner',
      'academic',
      'free',
      0
    )$$,
  'one_liner folder with subject is allowed'
);

select throws_ok(
  $$insert into public.material_folders (
      year_id, subject_id, name, library_type, content_surface, parent_id, entitlement
    ) values (
      (select year_id from curriculum),
      (select id from t_block1),
      'Nested',
      'one_liner',
      'academic',
      'b1111111-1111-1111-1111-111111111111'::uuid,
      'free'
    )$$,
  '23514',
  null,
  'one_liner nested parent_id is rejected'
);

select lives_ok(
  $$insert into public.materials (
      id, folder_id, title, kind, status, file_type,
      r2_object_key, r2_content_type, r2_byte_size, sort_order
    ) values (
      'b2222222-2222-2222-2222-222222222222'::uuid,
      'b1111111-1111-1111-1111-111111111111'::uuid,
      'Week 1.pdf',
      'pdf',
      'published',
      'pdf',
      'study-content/test/one-liner-week1.pdf',
      'application/pdf',
      4096,
      0
    )$$,
  'PDF may attach to one_liner folder'
);

------------------------------------------------------------------
-- Student visibility + authorize
------------------------------------------------------------------
select test_helpers.as_user((select id from t_stu_a));

select ok(
  public.can_view_material_folder('b1111111-1111-1111-1111-111111111111'::uuid)
  and public.can_access_material_folder('b1111111-1111-1111-1111-111111111111'::uuid),
  'enrolled entitled student can view/access one_liner folder'
);

select is(
  public.authorize_study_object('b2222222-2222-2222-2222-222222222222'::uuid),
  'study-content/test/one-liner-week1.pdf',
  'student may authorize one_liner PDF object key'
);

select test_helpers.as_user((select id from t_other_year));
select ok(
  not public.can_view_material_folder('b1111111-1111-1111-1111-111111111111'::uuid),
  'wrong-year student cannot view one_liner folder'
);

select throws_ok(
  $$select public.authorize_study_object('b2222222-2222-2222-2222-222222222222'::uuid)$$,
  'study_object_denied',
  'wrong-year student cannot authorize one_liner PDF'
);

------------------------------------------------------------------
-- Paid entitlement lock
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'materials_folder',
  'b1111111-1111-1111-1111-111111111111'::uuid,
  'any_subscription'
);

-- Drop live sub → expired entitlement
select test_helpers.as_runner();
update public.subscriptions
set status = 'expired',
    starts_at = now() - interval '40 days',
    ends_at = now() - interval '10 days'
where student_id = (select id from t_stu_a);

select test_helpers.as_user((select id from t_stu_a));
select ok(
  public.can_view_material_folder('b1111111-1111-1111-1111-111111111111'::uuid)
  and not public.can_access_material_folder('b1111111-1111-1111-1111-111111111111'::uuid),
  'expired entitlement: catalog view ok, content access denied'
);

select throws_ok(
  $$select public.authorize_study_object('b2222222-2222-2222-2222-222222222222'::uuid)$$,
  'study_object_denied',
  'expired entitlement denies PDF authorize'
);

-- Restore sub for highlight tests
select test_helpers.as_runner();
update public.subscriptions
set status = 'active',
    starts_at = now() - interval '1 day',
    ends_at = now() + interval '30 days'
where student_id = (select id from t_stu_a);

------------------------------------------------------------------
-- Highlights: create, persist, peer isolation
------------------------------------------------------------------
select test_helpers.as_user((select id from t_stu_a));
select lives_ok(
  $$insert into public.pdf_highlights (
      student_id, material_id, page_number, rects, selected_text, color
    ) values (
      (select id from t_stu_a),
      'b2222222-2222-2222-2222-222222222222'::uuid,
      1,
      '[{"x1":1,"y1":2,"x2":3,"y2":4}]'::jsonb,
      'high-yield line',
      '#fde047'
    )$$,
  'entitled student may create highlight on one_liner PDF'
);

select is(
  (select count(*)::int from public.pdf_highlights
    where material_id = 'b2222222-2222-2222-2222-222222222222'::uuid),
  1,
  'highlight persists for owner'
);

select test_helpers.as_user((select id from t_stu_b));
select is(
  (select count(*)::int from public.pdf_highlights
    where material_id = 'b2222222-2222-2222-2222-222222222222'::uuid),
  0,
  'peer cannot see another student highlight'
);

select lives_ok(
  $$insert into public.pdf_highlights (
      student_id, material_id, page_number, rects, selected_text
    ) values (
      (select id from t_stu_b),
      'b2222222-2222-2222-2222-222222222222'::uuid,
      1,
      '[{"x1":10,"y1":20,"x2":30,"y2":40}]'::jsonb,
      'peer note'
    )$$,
  'peer may create their own highlight'
);

select is(
  (select count(*)::int from public.pdf_highlights
    where material_id = 'b2222222-2222-2222-2222-222222222222'::uuid),
  1,
  'peer only sees own highlight row'
);

------------------------------------------------------------------
-- Soft-delete folder removes access
------------------------------------------------------------------
select test_helpers.as_runner();
update public.material_folders
set deleted_at = now(), purge_after = now() + interval '7 days'
where id = 'b1111111-1111-1111-1111-111111111111'::uuid;

select test_helpers.as_user((select id from t_stu_a));
select ok(
  not public.can_view_material_folder('b1111111-1111-1111-1111-111111111111'::uuid),
  'soft-deleted one_liner folder is not viewable'
);

select throws_ok(
  $$select public.authorize_study_object('b2222222-2222-2222-2222-222222222222'::uuid)$$,
  'study_object_denied',
  'soft-deleted folder denies PDF authorize'
);

select * from finish();
rollback;
