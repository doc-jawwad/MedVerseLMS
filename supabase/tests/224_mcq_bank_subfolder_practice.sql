-- Academic MCQ Bank subfolder practice: undone-first, favorites/incorrect,
-- done/restart, 100% empty, folder aggregate (excludes legacy), isolation.
begin;
select plan(22);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Sub Prac Paid') as id
  into temp t_paid;
select test_helpers.make_student((select year_id from curriculum), 'Sub Prac Other') as id
  into temp t_other;
select test_helpers.make_admin('Sub Prac Admin') as id into temp t_admin;

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
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa52'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb52'
where id = (select id from t_other);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc52'
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

grant select on curriculum, t_paid, t_other, t_admin, t_plan, t_block1
  to authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select year_id from curriculum), 'Sub Prac Anatomy', 93);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select year_id from curriculum) and name = 'Sub Prac Anatomy'
  order by created_at desc limit 1;
grant select on t_anatomy to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'free'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'Sub Prac Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Sub Prac Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Sub Prac Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;
grant select on t_book, t_chapter, t_topic to authenticated;

create temporary table t_qs (id uuid, n int, sf text);
grant select, insert on t_qs to authenticated;

select test_helpers.as_user((select id from t_admin));
do $$
declare i int; v_id uuid;
begin
  for i in 1..6 loop
    v_id := test_helpers.make_question((select id from t_topic), 'A');
    update public.questions set status = 'approved' where id = v_id;
    insert into t_qs (id, n, sf) values (v_id, i, case when i <= 4 then 'a' else 'b' end);
  end loop;
end;
$$;

select test_helpers.as_user((select id from t_admin));
create temporary table t_folder (id uuid);
create temporary table t_sf_a (id uuid);
create temporary table t_sf_b (id uuid);
grant select, insert on t_folder, t_sf_a, t_sf_b to authenticated;

insert into t_folder (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Sub Prac Folder');
insert into t_sf_a (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), 'Sub Prac A');
insert into t_sf_b (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), 'Sub Prac B');

do $$
declare r record;
begin
  for r in select id from t_qs where sf = 'a' loop
    perform public.admin_assign_unassigned_question_to_subfolder(
      r.id, (select id from t_sf_a)
    );
  end loop;
  for r in select id from t_qs where sf = 'b' loop
    perform public.admin_assign_unassigned_question_to_subfolder(
      r.id, (select id from t_sf_b)
    );
  end loop;
end;
$$;

-- Store version id for incorrect submit
create temporary table t_q1_ver (id uuid);
grant select, insert on t_q1_ver to authenticated;
insert into t_q1_ver (id)
select current_version_id from public.questions where id = (select id from t_qs where n = 1);

grant select on t_qs, t_folder, t_sf_a, t_sf_b, t_q1_ver to authenticated;

-- 1–3. start progress + undone-first batch
select test_helpers.as_user((select id from t_paid));
select is(
  (public.get_mcq_bank_subfolder_practice_progress((select id from t_sf_a))->>'total')::int,
  4,
  '1. subfolder A total is 4'
);
select is(
  (public.get_mcq_bank_subfolder_practice_progress((select id from t_sf_a))->>'done')::int,
  0,
  '2. subfolder A starts at 0 done'
);
select ok(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_subfolder', (select id from t_sf_a), 50
  )) = 4,
  '3. batch returns all remaining in subfolder A'
);

-- 4–6. mark one done → undone-first excludes it
select public.set_practice_item_state(
  'question', (select id from t_qs where n = 1), 'done'
);
select is(
  (public.get_mcq_bank_subfolder_practice_progress((select id from t_sf_a))->>'done')::int,
  1,
  '4. 1/4 after one done'
);
select ok(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_subfolder', (select id from t_sf_a), 50
  )) = 3,
  '5. batch returns 3 remaining'
);
select ok(
  not exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_subfolder', (select id from t_sf_a), 50
    ) b
    where b.question_id = (select id from t_qs where n = 1)
  ),
  '6. completed question excluded while undone remain'
);

-- 7–9. favorites + incorrect scopes
select public.set_practice_item_marked(
  'question', (select id from t_qs where n = 2), true
);
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_subfolder_favorites', (select id from t_sf_a), 50
  )),
  1,
  '7. favorites batch size 1'
);
select is(
  (
    select question_id from public.get_practice_batch(
      'mcq_bank_subfolder_favorites', (select id from t_sf_a), 50
    ) limit 1
  ),
  (select id from t_qs where n = 2),
  '8. favorites batch contains marked question'
);

select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''B'')',
    (select id from t_q1_ver)
  ),
  '9. wrong answer creates Incorrect'
);
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_subfolder_incorrect', (select id from t_sf_a), 50
  )),
  1,
  '10. incorrect batch size 1'
);

-- 11–13. finish remaining → 100% empty; restart
do $$
declare r record;
begin
  for r in select id from t_qs where sf = 'a' and n <> 1 loop
    perform public.set_practice_item_state('question', r.id, 'done');
  end loop;
end;
$$;
select ok(
  (public.get_mcq_bank_subfolder_practice_progress((select id from t_sf_a))->>'complete')::boolean,
  '11. subfolder A complete at 100%'
);
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_subfolder', (select id from t_sf_a), 50
  )),
  0,
  '12. 100% batch empty — no silent re-round'
);
select ok(
  (public.reset_mcq_bank_subfolder_practice((select id from t_sf_a))->>'reset_count')::int = 4,
  '13. restart resets 4 done rows'
);
select is(
  (public.get_mcq_bank_subfolder_practice_progress((select id from t_sf_a))->>'done')::int,
  0,
  '14. after restart progress is 0/4'
);

-- 15–18. folder aggregate = sum of subfolders; legacy insert blocked
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder))->>'total')::int,
  6,
  '15. folder aggregate total = 4+2 subfolder questions'
);

select public.set_practice_item_state(
  'question', (select id from t_qs where n = 5), 'done'
);
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder))->>'done')::int,
  1,
  '16. folder done counts across subfolders'
);
select is(
  (public.get_mcq_bank_subfolder_practice_progress((select id from t_sf_b))->>'done')::int,
  1,
  '17. subfolder B shows its own done=1'
);

-- Legacy folder-only insert blocked by trigger — document skip
select test_helpers.as_runner();
select throws_ok(
  format(
    $q$insert into public.questions (
      topic_id, status, difficulty, content_hash, stem_normalized, mcq_bank_folder_id
    ) values (
      %L::uuid, 'approved', 'medium',
      'legacy-hash-' || gen_random_uuid()::text,
      'legacy folder-only stem',
      %L::uuid
    )$q$,
    (select id from t_topic),
    (select id from t_folder)
  ),
  'P0001',
  'mcq_bank_requires_subfolder',
  '18. legacy folder-only insert blocked (skipped for aggregate exclusion fixture)'
);

select test_helpers.as_user((select id from t_paid));
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder))->>'total')::int,
  6,
  '19. folder total unchanged after blocked legacy insert'
);

-- 20–22. student isolation
select test_helpers.as_user((select id from t_other));
select is(
  (public.get_mcq_bank_subfolder_practice_progress((select id from t_sf_a))->>'done')::int,
  0,
  '20. peer sees 0 done on subfolder A'
);
select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder))->>'done')::int,
  0,
  '21. peer sees 0 done on folder aggregate'
);
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_subfolder_favorites', (select id from t_sf_a), 50
  )),
  0,
  '22. peer favorites batch empty (isolation)'
);

select * from finish();
rollback;
