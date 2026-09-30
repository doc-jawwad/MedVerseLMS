-- pdf_reading_progress: own-row RLS, peer isolation, entitlement, upsert, page_number check.
begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Prog Student A') as id
  into temp t_stu_a;
select test_helpers.make_student((select year_id from curriculum), 'Prog Student B') as id
  into temp t_stu_b;

select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
where id = (select id from t_stu_a);
update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'
where id = (select id from t_stu_b);

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

insert into public.material_folders (id, year_id, name, entitlement)
values (
  'c1111111-1111-1111-1111-111111111111'::uuid,
  (select year_id from curriculum),
  'Progress Free Folder',
  'free'
);

insert into public.material_folders (id, year_id, name, entitlement)
values (
  'c1111111-1111-1111-1111-111111111112'::uuid,
  (select year_id from curriculum),
  'Progress Paid Folder',
  'free'
);

select test_helpers.make_admin('Prog Admin') as id into temp t_admin;
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'
where id = (select id from t_admin);

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'materials_folder',
  'c1111111-1111-1111-1111-111111111112'::uuid,
  'any_subscription'
);
select test_helpers.as_runner();

insert into public.materials (
  id, folder_id, title, kind, status, r2_object_key, file_type
) values (
  'c2222222-2222-2222-2222-222222222222'::uuid,
  'c1111111-1111-1111-1111-111111111111'::uuid,
  'Progress Free PDF',
  'pdf',
  'published',
  'study-content/tenant/admin/progress-free',
  'pdf'
);

insert into public.materials (
  id, folder_id, title, kind, status, r2_object_key, file_type
) values (
  'c2222222-2222-2222-2222-222222222223'::uuid,
  'c1111111-1111-1111-1111-111111111112'::uuid,
  'Progress Paid PDF',
  'pdf',
  'published',
  'study-content/tenant/admin/progress-paid',
  'pdf'
);

-- Student A has no paid access yet for paid folder tests
select test_helpers.as_runner();
delete from public.subscriptions where student_id = (select id from t_stu_a);

grant select on curriculum, t_stu_a, t_stu_b, t_plan, t_admin
  to authenticated;

------------------------------------------------------------------
-- Entitled write / read / upsert / peer isolation
------------------------------------------------------------------
select test_helpers.as_user((select id from t_stu_a));

select lives_ok(
  $$insert into public.pdf_reading_progress (
      student_id, material_id, page_number
    ) values (
      (select id from t_stu_a),
      'c2222222-2222-2222-2222-222222222222'::uuid,
      15
    )$$,
  'entitled student may insert reading progress'
);

select is(
  (select page_number from public.pdf_reading_progress
    where material_id = 'c2222222-2222-2222-2222-222222222222'::uuid),
  15,
  'owner can read own progress page'
);

select lives_ok(
  $$insert into public.pdf_reading_progress (
      student_id, material_id, page_number
    ) values (
      (select id from t_stu_a),
      'c2222222-2222-2222-2222-222222222222'::uuid,
      20
    )
    on conflict (student_id, material_id) do update
      set page_number = excluded.page_number$$,
  'upsert updates last page for same student+material'
);

select is(
  (select page_number from public.pdf_reading_progress
    where material_id = 'c2222222-2222-2222-2222-222222222222'::uuid),
  20,
  'upsert stores latest page_number'
);

select throws_ok(
  $$insert into public.pdf_reading_progress (
      student_id, material_id, page_number
    ) values (
      (select id from t_stu_a),
      'c2222222-2222-2222-2222-222222222222'::uuid,
      0
    )$$,
  '23514',
  null,
  'page_number must be >= 1'
);

------------------------------------------------------------------
-- Peer isolation
------------------------------------------------------------------
select test_helpers.as_user((select id from t_stu_b));
select is(
  (select count(*)::int from public.pdf_reading_progress
    where material_id = 'c2222222-2222-2222-2222-222222222222'::uuid),
  0,
  'peer cannot see another student reading progress'
);

select lives_ok(
  $$insert into public.pdf_reading_progress (
      student_id, material_id, page_number
    ) values (
      (select id from t_stu_b),
      'c2222222-2222-2222-2222-222222222222'::uuid,
      3
    )$$,
  'peer may create their own progress row'
);

select is(
  (select page_number from public.pdf_reading_progress
    where material_id = 'c2222222-2222-2222-2222-222222222222'::uuid),
  3,
  'peer only sees own progress page'
);

------------------------------------------------------------------
-- Entitlement denial (paid PDF without subscription)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_stu_a));
select throws_ok(
  $$insert into public.pdf_reading_progress (
      student_id, material_id, page_number
    ) values (
      (select id from t_stu_a),
      'c2222222-2222-2222-2222-222222222223'::uuid,
      1
    )$$,
  '42501',
  null,
  'without entitlement cannot write progress on paid PDF'
);

-- Restore sub: entitled student can write paid progress
select test_helpers.as_runner();
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

select test_helpers.as_user((select id from t_stu_a));
select lives_ok(
  $$insert into public.pdf_reading_progress (
      student_id, material_id, page_number
    ) values (
      (select id from t_stu_a),
      'c2222222-2222-2222-2222-222222222223'::uuid,
      7
    )$$,
  'with subscription entitled student may save paid PDF progress'
);

select * from finish();
rollback;
