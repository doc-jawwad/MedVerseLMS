-- Incorrect is NOT entitlement: expire / class-switch / free / re-subscribe.
begin;
select plan(17);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id as id into temp t_y1 from public.years where year_number = 1;
select id as id into temp t_y2 from public.years where year_number = 2;

select test_helpers.make_student((select id from t_y1), 'Inc Ent Paid') as id
  into temp t_paid;
select test_helpers.make_student((select id from t_y1), 'Inc Ent FreeStu') as id
  into temp t_free_stu;
select test_helpers.make_admin('Inc Ent Admin') as id into temp t_admin;

select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

select id into temp t_block1_y1
  from public.subjects
  where year_id = (select id from t_y1) and product_key = 'block-1'
  limit 1;
select id into temp t_free_block
  from public.subjects
  where year_id = (select id from t_y1) and product_key = 'block-2'
  limit 1;
select id into temp t_block_y2
  from public.subjects
  where year_id = (select id from t_y2) and product_key = 'block-4'
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa43'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb43'
where id = (select id from t_free_stu);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc43'
where id = (select id from t_admin);

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_paid),
  (select id from t_plan),
  (select id from t_y1),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

grant select on curriculum, t_y1, t_y2, t_paid, t_free_stu, t_admin, t_plan, t_block1_y1, t_free_block, t_block_y2
  to authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1_y1), 'any_subscription'
);
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block_y2), 'any_subscription'
);
select public.set_resource_entitlement(
  'practice_subject', (select id from t_free_block), 'free'
);

select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select id from t_y1), 'Inc Ent Anatomy Y1', 43);
select id into temp t_anatomy_y1
  from public.subjects
  where year_id = (select id from t_y1) and name = 'Inc Ent Anatomy Y1'
  order by created_at desc limit 1;
grant select on t_anatomy_y1 to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy_y1), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy_y1), 'Inc Ent Book Y1');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy_y1) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Inc Ent Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Inc Ent Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;
grant select on t_book, t_chapter, t_topic to authenticated;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_paid;
update public.questions set status = 'approved' where id = (select id from t_q_paid);
select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_free;
update public.questions set status = 'approved' where id = (select id from t_q_free);
grant select on t_q_paid, t_q_free to authenticated;

create temporary table t_q_paid_ver (id uuid);
create temporary table t_q_free_ver (id uuid);
grant select, insert on t_q_paid_ver, t_q_free_ver to authenticated;
insert into t_q_paid_ver (id)
select current_version_id from public.questions where id = (select id from t_q_paid);
insert into t_q_free_ver (id)
select current_version_id from public.questions where id = (select id from t_q_free);

select test_helpers.as_user((select id from t_admin));
create temporary table t_folder_y1 (id uuid);
create temporary table t_folder_y2 (id uuid);
create temporary table t_folder_free (id uuid);
grant select, insert on t_folder_y1, t_folder_y2, t_folder_free to authenticated;

insert into t_folder_y1 (id)
select public.admin_create_mcq_bank_folder((select id from t_block1_y1), 'Inc Ent Paid Folder Y1');
insert into t_folder_free (id)
select public.admin_create_mcq_bank_folder((select id from t_free_block), 'Inc Ent Free Folder');

select public.admin_assign_unassigned_question_to_folder(
  (select id from t_q_paid), (select id from t_folder_y1)
);
select public.admin_assign_unassigned_question_to_folder(
  (select id from t_q_free), (select id from t_folder_free)
);

select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select id from t_y2), 'Inc Ent Anatomy Y2', 44);
select id into temp t_anatomy_y2
  from public.subjects
  where year_id = (select id from t_y2) and name = 'Inc Ent Anatomy Y2'
  order by created_at desc limit 1;
grant select on t_anatomy_y2 to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy_y2), 'any_subscription'
);
select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy_y2), 'Inc Ent Book Y2');
select id into temp t_book2 from public.books
  where subject_id = (select id from t_anatomy_y2) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book2), 'Inc Ent Ch Y2');
select id into temp t_chapter2 from public.chapters
  where book_id = (select id from t_book2) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter2), 'Inc Ent Topic Y2');
select id into temp t_topic2 from public.topics
  where chapter_id = (select id from t_chapter2) order by created_at desc limit 1;
grant select on t_book2, t_chapter2, t_topic2 to authenticated;

select test_helpers.make_question((select id from t_topic2), 'A') as id into temp t_q_y2;
update public.questions set status = 'approved' where id = (select id from t_q_y2);
grant select on t_q_y2 to authenticated;

create temporary table t_q_y2_ver (id uuid);
grant select, insert on t_q_y2_ver to authenticated;
insert into t_q_y2_ver (id)
select current_version_id from public.questions where id = (select id from t_q_y2);

select test_helpers.as_user((select id from t_admin));
insert into t_folder_y2 (id)
select public.admin_create_mcq_bank_folder((select id from t_block_y2), 'Inc Ent Paid Folder Y2');
select public.admin_assign_unassigned_question_to_folder(
  (select id from t_q_y2), (select id from t_folder_y2)
);

------------------------------------------------------------------
-- A) Active paid → wrong answer → Incorrect practiceable
------------------------------------------------------------------
select test_helpers.as_user((select id from t_paid));
select ok(
  public.can_access_mcq_bank_folder_practice((select id from t_folder_y1)),
  'A1 paid can access Y1 folder practice'
);
select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''B'')',
    (select id from t_q_paid_ver)
  ),
  'A2 wrong answer on paid MCQ'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_incorrect', (select id from t_folder_y1), 50
    ) where question_id = (select id from t_q_paid)
  ),
  'A3 Incorrect practice returns paid MCQ'
);
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder_y1))->>'incorrect')::int,
  1,
  'A4 progress incorrect count is 1'
);

------------------------------------------------------------------
-- B) Expire subscription → Incorrect NOT practiceable
------------------------------------------------------------------
select test_helpers.as_runner();
update public.subscriptions
set ends_at = now() - interval '1 hour'
where student_id = (select id from t_paid);

select test_helpers.as_user((select id from t_paid));
select ok(
  (
    select incorrect from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_paid)
  ),
  'B1 incorrect row persists after expire (historical)'
);
select ok(
  not public.can_access_mcq_bank_folder_practice((select id from t_folder_y1)),
  'B2 folder practice access denied after expire'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_folder_incorrect'', %L::uuid, 5)',
    (select id from t_folder_y1)
  ),
  'P0001',
  'practice_access_denied',
  'B3 Incorrect practice denied after expire'
);
select throws_ok(
  format(
    'select public.get_mcq_bank_folder_practice_progress(%L::uuid)',
    (select id from t_folder_y1)
  ),
  'P0001',
  'practice_access_denied',
  'B4 Incorrect listing/progress denied after expire'
);

------------------------------------------------------------------
-- C) Direct questions SELECT cannot leak
------------------------------------------------------------------
select is(
  (select count(*)::int from public.questions where id = (select id from t_q_paid)),
  0,
  'C1 student cannot SELECT incorrect question row directly'
);

------------------------------------------------------------------
-- D) Class switch → old-class Incorrect inaccessible
------------------------------------------------------------------
select test_helpers.as_runner();
update public.subscriptions
set ends_at = now() + interval '30 days',
    year_id = (select id from t_y2)
where student_id = (select id from t_paid);
update public.enrollments
set status = 'expired'
where student_id = (select id from t_paid)
  and year_id = (select id from t_y1)
  and status = 'active';
insert into public.enrollments (student_id, year_id, status)
values ((select id from t_paid), (select id from t_y2), 'active');

select test_helpers.as_user((select id from t_paid));
select ok(
  (
    select incorrect from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_paid)
  ),
  'D1 old-class incorrect row still stored'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_folder_incorrect'', %L::uuid, 5)',
    (select id from t_folder_y1)
  ),
  'P0001',
  'practice_access_denied',
  'D2 old-class Incorrect practice denied after class switch'
);
select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''B'')',
    (select id from t_q_y2_ver)
  ),
  'D3 wrong answer on new-class MCQ'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_incorrect', (select id from t_folder_y2), 50
    ) where question_id = (select id from t_q_y2)
  ),
  'D4 new-class Incorrect practice returns new incorrect'
);

------------------------------------------------------------------
-- E) Re-enroll old class → stored Incorrect accessible again
------------------------------------------------------------------
select test_helpers.as_runner();
update public.enrollments
set status = 'expired'
where student_id = (select id from t_paid)
  and year_id = (select id from t_y2)
  and status = 'active';
update public.enrollments
set status = 'active'
where student_id = (select id from t_paid)
  and year_id = (select id from t_y1);
update public.subscriptions
set year_id = (select id from t_y1),
    ends_at = now() + interval '30 days'
where student_id = (select id from t_paid);

select test_helpers.as_user((select id from t_paid));
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_incorrect', (select id from t_folder_y1), 50
    ) where question_id = (select id from t_q_paid)
  ),
  'E re-authorized: previously stored Y1 Incorrect practiceable again'
);

------------------------------------------------------------------
-- F) Free folder Incorrect without subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_free_stu));
select ok(
  public.can_access_mcq_bank_folder_practice((select id from t_folder_free))
  and not public.has_live_subscription(),
  'F1 free student has folder access without live subscription'
);
select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''B'')',
    (select id from t_q_free_ver)
  ),
  'F2 wrong answer on free MCQ'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_incorrect', (select id from t_folder_free), 50
    ) where question_id = (select id from t_q_free)
  ),
  'F3 free Incorrect practice returns free MCQ'
);

select * from finish();
rollback;
