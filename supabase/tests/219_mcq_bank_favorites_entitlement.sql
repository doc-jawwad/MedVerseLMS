-- Favorites are NOT entitlement: expire / class-switch / free / re-subscribe.
begin;
select plan(18);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id as id into temp t_y1 from public.years where year_number = 1;
select id as id into temp t_y2 from public.years where year_number = 2;

select test_helpers.make_student((select id from t_y1), 'Fav Ent Paid') as id
  into temp t_paid;
select test_helpers.make_student((select id from t_y1), 'Fav Ent FreeStu') as id
  into temp t_free_stu;
select test_helpers.make_admin('Fav Ent Admin') as id into temp t_admin;

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
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb33'
where id = (select id from t_free_stu);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc33'
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

-- Paid block requires subscription; free product subject for free Favorites
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

-- Departmental taxonomy for questions (also subscription-gated so expire blocks subject path)
select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select id from t_y1), 'Fav Ent Anatomy Y1', 43);
select id into temp t_anatomy_y1
  from public.subjects
  where year_id = (select id from t_y1) and name = 'Fav Ent Anatomy Y1'
  order by created_at desc limit 1;
grant select on t_anatomy_y1 to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy_y1), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy_y1), 'Fav Ent Book Y1');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy_y1) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Fav Ent Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Fav Ent Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;
grant select on t_book, t_chapter, t_topic to authenticated;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_paid;
update public.questions set status = 'approved' where id = (select id from t_q_paid);
select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_free;
update public.questions set status = 'approved' where id = (select id from t_q_free);
grant select on t_q_paid, t_q_free to authenticated;

select test_helpers.as_user((select id from t_admin));
create temporary table t_folder_y1 (id uuid);
create temporary table t_folder_y2 (id uuid);
create temporary table t_folder_free (id uuid);
grant select, insert on t_folder_y1, t_folder_y2, t_folder_free to authenticated;

create temporary table t_sf_y1 (id uuid);
create temporary table t_sf_free (id uuid);
create temporary table t_sf_y2 (id uuid);
grant select, insert on t_sf_y1, t_sf_free, t_sf_y2 to authenticated;

insert into t_folder_y1 (id)
select public.admin_create_mcq_bank_folder((select id from t_block1_y1), 'Fav Ent Paid Folder Y1');
insert into t_folder_free (id)
select public.admin_create_mcq_bank_folder((select id from t_free_block), 'Fav Ent Free Folder');
insert into t_sf_y1 (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder_y1), 'Fav Ent Sub Y1');
insert into t_sf_free (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder_free), 'Fav Ent Sub Free');

select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q_paid), (select id from t_sf_y1)
);
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q_free), (select id from t_sf_free)
);

-- Y2 folder + question for class-switch destination
select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select id from t_y2), 'Fav Ent Anatomy Y2', 44);
select id into temp t_anatomy_y2
  from public.subjects
  where year_id = (select id from t_y2) and name = 'Fav Ent Anatomy Y2'
  order by created_at desc limit 1;
grant select on t_anatomy_y2 to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy_y2), 'any_subscription'
);
select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy_y2), 'Fav Ent Book Y2');
select id into temp t_book2 from public.books
  where subject_id = (select id from t_anatomy_y2) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book2), 'Fav Ent Ch Y2');
select id into temp t_chapter2 from public.chapters
  where book_id = (select id from t_book2) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter2), 'Fav Ent Topic Y2');
select id into temp t_topic2 from public.topics
  where chapter_id = (select id from t_chapter2) order by created_at desc limit 1;
grant select on t_book2, t_chapter2, t_topic2 to authenticated;

select test_helpers.make_question((select id from t_topic2), 'A') as id into temp t_q_y2;
update public.questions set status = 'approved' where id = (select id from t_q_y2);
grant select on t_q_y2 to authenticated;

select test_helpers.as_user((select id from t_admin));
insert into t_folder_y2 (id)
select public.admin_create_mcq_bank_folder((select id from t_block_y2), 'Fav Ent Paid Folder Y2');
insert into t_sf_y2 (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder_y2), 'Fav Ent Sub Y2');
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q_y2), (select id from t_sf_y2)
);

------------------------------------------------------------------
-- A) Active paid → favorite paid MCQ → visible/practiceable
------------------------------------------------------------------
select test_helpers.as_user((select id from t_paid));
select ok(
  public.can_access_mcq_bank_folder_practice((select id from t_folder_y1)),
  'A1 paid can access Y1 folder practice'
);
select lives_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, true)',
    (select id from t_q_paid)
  ),
  'A2 favorite paid MCQ'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_favorites', (select id from t_folder_y1), 50
    ) where question_id = (select id from t_q_paid)
  ),
  'A3 favorites practice returns paid MCQ'
);
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder_y1))->>'favorites')::int,
  1,
  'A4 progress favorites count is 1'
);

------------------------------------------------------------------
-- B) Expire subscription → same favorite NOT practiceable / not listed
------------------------------------------------------------------
select test_helpers.as_runner();
update public.subscriptions
set ends_at = now() - interval '1 hour'
where student_id = (select id from t_paid);

select test_helpers.as_user((select id from t_paid));
select ok(
  (
    select marked from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_paid)
  ),
  'B1 marked row persists after expire (historical)'
);
select ok(
  not public.can_access_mcq_bank_folder_practice((select id from t_folder_y1)),
  'B2 folder practice access denied after expire'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_folder_favorites'', %L::uuid, 5)',
    (select id from t_folder_y1)
  ),
  'P0001',
  'practice_access_denied',
  'B3 favorites practice denied after expire'
);
select throws_ok(
  format(
    'select public.get_mcq_bank_folder_practice_progress(%L::uuid)',
    (select id from t_folder_y1)
  ),
  'P0001',
  'practice_access_denied',
  'B4 favorites listing/progress denied after expire'
);

------------------------------------------------------------------
-- C) Direct questions SELECT / unauthorized RPCs cannot retrieve content
------------------------------------------------------------------
select is(
  (select count(*)::int from public.questions where id = (select id from t_q_paid)),
  0,
  'C1 student cannot SELECT favorited question row directly'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_folder'', %L::uuid, 5)',
    (select id from t_folder_y1)
  ),
  'P0001',
  'practice_access_denied',
  'C2 normal folder practice also denied (same gate)'
);

------------------------------------------------------------------
-- D) Class switch → old-class favorite inaccessible; new-class works
------------------------------------------------------------------
select test_helpers.as_runner();
-- Restore live subscription for class-switch scenario
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
    select marked from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_paid)
  ),
  'D1 old-class favorite marked row still stored'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_folder_favorites'', %L::uuid, 5)',
    (select id from t_folder_y1)
  ),
  'P0001',
  'practice_access_denied',
  'D2 old-class favorites practice denied after class switch'
);
select lives_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, true)',
    (select id from t_q_y2)
  ),
  'D3 favorite new-class MCQ'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_favorites', (select id from t_folder_y2), 50
    ) where question_id = (select id from t_q_y2)
  ),
  'D4 new-class favorites practice returns new favorite'
);

------------------------------------------------------------------
-- E) Re-subscribe / re-enroll to old class → stored favorite accessible again
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
      'mcq_bank_folder_favorites', (select id from t_folder_y1), 50
    ) where question_id = (select id from t_q_paid)
  ),
  'E re-authorized: previously stored Y1 favorite practiceable again'
);

------------------------------------------------------------------
-- F) Free folder Favorites accessible without subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_free_stu));
select ok(
  public.can_access_mcq_bank_folder_practice((select id from t_folder_free))
  and not public.has_live_subscription(),
  'F1 free student has folder access without live subscription'
);
select lives_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, true)',
    (select id from t_q_free)
  ),
  'F2 favorite free MCQ'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_favorites', (select id from t_folder_free), 50
    ) where question_id = (select id from t_q_free)
  ),
  'F3 free favorites practice returns free MCQ'
);

select * from finish();
rollback;
