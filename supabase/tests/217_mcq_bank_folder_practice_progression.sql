-- MCQ Bank folder practice progression: progress ring counts, undone-first,
-- 100% empty batch, explicit folder restart, student isolation.
begin;
select plan(18);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Prog Fold Paid') as id
  into temp t_paid;
select test_helpers.make_student((select year_id from curriculum), 'Prog Fold Other') as id
  into temp t_other;
select test_helpers.make_admin('Prog Fold Admin') as id into temp t_admin;

select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa31'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb31'
where id = (select id from t_other);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc31'
where id = (select id from t_admin);

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_paid),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

grant select on curriculum, t_paid, t_other, t_admin, t_plan, t_block1
  to authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select year_id from curriculum), 'Prog Fold Anatomy', 97);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select year_id from curriculum) and name = 'Prog Fold Anatomy'
  order by created_at desc limit 1;
grant select on t_anatomy to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'free'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'Prog Fold Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Prog Fold Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Prog Fold Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;

grant select on t_book, t_chapter, t_topic to authenticated;

create temporary table t_qs (id uuid, n int);
grant select, insert on t_qs to authenticated;

select test_helpers.as_user((select id from t_admin));
do $$
declare i int; v_id uuid;
begin
  for i in 1..10 loop
    v_id := test_helpers.make_question((select id from t_topic), 'A');
    update public.questions set status = 'approved' where id = v_id;
    insert into t_qs (id, n) values (v_id, i);
  end loop;
end;
$$;

-- make_question leaves runner (JWT cleared); re-impersonate admin for folder RPCs
select test_helpers.as_user((select id from t_admin));
create temporary table t_folder (id uuid);
create temporary table t_sf (id uuid);
grant select, insert on t_folder, t_sf to authenticated;
insert into t_folder (id)
select public.admin_create_mcq_bank_folder(
  (select id from t_block1),
  'QA Practice Progress Test'
);
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder(
  (select id from t_folder),
  'QA Practice Progress Sub'
);

do $$
declare r record;
begin
  for r in select id from t_qs loop
    perform public.admin_assign_unassigned_question_to_subfolder(
      r.id, (select id from t_sf)
    );
  end loop;
end;
$$;

grant select on t_qs, t_folder, t_sf to authenticated;

-- 1. 0/10
select test_helpers.as_user((select id from t_paid));
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder))
    ->> 'done')::int,
  0,
  '1. start at 0 done'
);
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'total')::int,
  10,
  '2. total is 10'
);
select ok(
  not (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'complete')::boolean,
  '3. not complete at 0/10'
);

-- Undone-first: batch returns only remaining; mark 1 done
select ok(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder', (select id from t_folder), 50
  )) = 10,
  '4. batch returns all 10 while all remaining'
);

select public.set_practice_item_state(
  'question', (select id from t_qs where n = 1), 'done'
);

select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'done')::int,
  1,
  '5. 1/10 after one done'
);

select ok(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder', (select id from t_folder), 50
  )) = 9,
  '6. batch returns 9 remaining after 1 done'
);

select ok(
  not exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder', (select id from t_folder), 50
    ) b
    where b.question_id = (select id from t_qs where n = 1)
  ),
  '7. completed question excluded while undone remain'
);

-- 5/10
select test_helpers.as_user((select id from t_paid));
do $$
declare r record;
begin
  for r in select id from t_qs where n between 2 and 5 loop
    perform public.set_practice_item_state('question', r.id, 'done');
  end loop;
end;
$$;

select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'done')::int,
  5,
  '8. 5/10 progress'
);
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'percent_complete')::int,
  50,
  '9. 50 percent at 5/10'
);

-- 9/10 then 10/10
do $$
declare r record;
begin
  for r in select id from t_qs where n between 6 and 9 loop
    perform public.set_practice_item_state('question', r.id, 'done');
  end loop;
end;
$$;
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'done')::int,
  9,
  '10. 9/10 progress'
);

select public.set_practice_item_state(
  'question', (select id from t_qs where n = 10), 'done'
);
select ok(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'complete')::boolean,
  '11. 10/10 complete'
);
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder', (select id from t_folder), 50
  )),
  0,
  '12. 100% batch empty — no silent re-round'
);

-- Explicit restart
select ok(
  (public.reset_mcq_bank_folder_practice((select id from t_folder)
    ) ->> 'reset_count')::int = 10,
  '13. restart resets 10 done rows'
);
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'done')::int,
  0,
  '14. after restart progress is 0/10'
);
select ok(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder', (select id from t_folder), 50
  )) = 10,
  '15. after restart batch serves all again'
);

-- Isolation: other student still 0/10
select test_helpers.as_user((select id from t_other));
-- other has no subscription — may be denied; grant complimentary path via free? block is any_subscription
-- Give other a live sub for isolation check
select test_helpers.as_runner();
insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_other),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

select test_helpers.as_user((select id from t_other));
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'done')::int,
  0,
  '16. second student sees 0/10 independently'
);

-- Peer cannot see paid student's done rows via progress RPC
select ok(
  not (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'complete')::boolean,
  '17. second student not complete'
);

-- Reload persistence: paid still 0 after own restart (already asserted);
-- mark 1 and re-fetch
select test_helpers.as_user((select id from t_paid));
select public.set_practice_item_state(
  'question', (select id from t_qs where n = 3), 'done'
);
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder)
    ) ->> 'done')::int,
  1,
  '18. progress persists on re-fetch (1/10)'
);

select * from finish();
rollback;
