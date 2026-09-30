-- MCQ Bank subfolder bulk move / soft-delete + folder CRUD invariants.
-- Folder bulk RPCs refuse (mcq_bank_use_subfolder_bulk); this suite uses subfolder APIs.
begin;
select plan(24);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_admin('MCQ Bulk Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'MCQ Bulk Edit',
  array['edit_questions']
) as id into temp t_edit;
select test_helpers.make_limited_admin(
  'MCQ Bulk WrongYear',
  array['edit_questions']
) as id into temp t_wrong;
select test_helpers.make_student((select year_id from curriculum), 'MCQ Bulk Student') as id
  into temp t_student;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

grant select on curriculum, t_year2, t_main, t_edit, t_wrong, t_student, t_block1
  to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_edit),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_wrong),
  array[(select id from t_year2)]
);

-- Folders A / B (no Source dependency)
create temporary table t_fa (id uuid);
create temporary table t_fb (id uuid);
create temporary table t_sa (id uuid);
create temporary table t_sb (id uuid);
grant select, insert on t_fa, t_fb, t_sa, t_sb to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
insert into t_fa (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Bulk Folder A');
insert into t_fb (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Bulk Folder B');

select ok(
  (select count(*)::int from public.mcq_bank_folders
   where id in ((select id from t_fa), (select id from t_fb))
     and deleted_at is null) = 2,
  '1. create two folders'
);

select lives_ok(
  $$select public.admin_rename_mcq_bank_folder((select id from t_fb), 'Bulk Folder B Renamed')$$,
  '2. rename folder'
);

select is(
  (select name from public.mcq_bank_folders where id = (select id from t_fb)),
  'Bulk Folder B Renamed',
  '3. rename persists'
);

-- Subfolder under A; create questions into it
insert into t_sa (id)
select public.admin_create_mcq_bank_subfolder((select id from t_fa), 'Bulk Sub A');

create temporary table t_qs (id uuid, n int);
grant select, insert on t_qs to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
do $$
declare
  i int;
  v_id uuid;
  v_opts jsonb := '[{"key":"A","text":"A"},{"key":"B","text":"B"},{"key":"C","text":"C"},{"key":"D","text":"D"}]'::jsonb;
begin
  for i in 1..12 loop
    v_id := public.create_question(
      (select topic_id from curriculum),
      'Bulk MCQ stem ' || i || ' ' || gen_random_uuid()::text,
      v_opts,
      'A',
      '',
      '',
      'medium',
      '{}',
      'approved',
      (select id from t_sa)
    );
    insert into t_qs (id, n) values (v_id, i);
  end loop;
end;
$$;

select is(
  (select count(*)::int from public.questions
   where mcq_bank_subfolder_id = (select id from t_sa) and deleted_at is null),
  12,
  '4. manual create places questions in subfolder A'
);

-- Empty folder delete OK for B (no live subfolders); A blocked
select lives_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_fb))$$,
  '5. empty folder soft-delete succeeds'
);

select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_fa))$$,
  'P0001',
  'folder_not_empty',
  '6. non-empty folder soft-delete blocked'
);

-- Recreate B + subfolder for move tests
select test_helpers.as_user((select id from t_edit));
delete from t_fb;
insert into t_fb (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Bulk Folder B');
delete from t_sb;
insert into t_sb (id)
select public.admin_create_mcq_bank_subfolder((select id from t_fb), 'Bulk Sub B');

-- Move 1 question
select ok(
  (select (public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    array[(select id from t_qs where n = 1)],
    false
  ) ->> 'moved')::int = 1),
  '7. bulk move 1 question'
);

select is(
  (select mcq_bank_subfolder_id from public.questions where id = (select id from t_qs where n = 1)),
  (select id from t_sb),
  '8. moved question destination correct'
);

select ok(
  (select id from t_qs where n = 1) =
  (select id from public.questions where id = (select id from t_qs where n = 1)),
  '9. question id preserved after move'
);

-- Move multiple (5)
select ok(
  (select (public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    (select array_agg(id) from t_qs where n between 2 and 6),
    false
  ) ->> 'moved')::int = 5),
  '10. bulk move multiple questions'
);

select is(
  (select count(*)::int from public.questions
   where mcq_bank_subfolder_id = (select id from t_sa) and deleted_at is null),
  6,
  '11. source subfolder count after partial move'
);

select is(
  (select count(*)::int from public.questions
   where mcq_bank_subfolder_id = (select id from t_sb) and deleted_at is null),
  6,
  '12. dest subfolder count after moves'
);

-- Move remaining all-in-source
select ok(
  (select (public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    null,
    true
  ) ->> 'moved')::int = 6),
  '13. bulk move all remaining in source'
);

select is(
  (select count(*)::int from public.questions
   where mcq_bank_subfolder_id = (select id from t_sa) and deleted_at is null),
  0,
  '14. source empty after all-in-source move'
);

-- Unauthorized year rejected
select test_helpers.as_user((select id from t_wrong));
select throws_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sb),
    (select id from t_sa),
    null,
    true
  )$$,
  'P0001',
  'year_scope_denied',
  '15. wrong-year admin cannot bulk move'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sb),
    (select id from t_sa),
    null,
    true
  )$$,
  'P0001',
  'permission_denied',
  '16. student cannot bulk move'
);

-- Bulk soft-delete selected (5) then remaining
select test_helpers.as_user((select id from t_edit));
select ok(
  (select (public.admin_bulk_soft_delete_subfolder_questions(
    (select id from t_sb),
    (select array_agg(id) from t_qs where n between 1 and 5),
    false
  ) ->> 'binned')::int = 5),
  '17. bulk soft-delete selected'
);

select is(
  (select count(*)::int from public.questions
   where mcq_bank_subfolder_id = (select id from t_sb) and deleted_at is null),
  7,
  '18. live questions remain after partial bin'
);

select ok(
  (select (public.admin_bulk_soft_delete_subfolder_questions(
    (select id from t_sb),
    null,
    true
  ) ->> 'binned')::int = 7),
  '19. bulk soft-delete all remaining in subfolder'
);

select is(
  (select count(*)::int from public.questions
   where id in (select id from t_qs) and deleted_at is null),
  0,
  '20. all small-batch questions soft-deleted'
);

-- Soft-deleted questions keep versions (no orphan wipe)
select ok(
  (select count(*)::int from public.question_versions qv
   where qv.question_id in (select id from t_qs)) >= 12,
  '21. question versions retained after soft-delete'
);

-- Clear live empty subfolder then delete folder B
select lives_ok(
  $$do $d$ begin
    perform public.admin_soft_delete_mcq_bank_subfolder((select id from t_sb));
    perform public.admin_soft_delete_mcq_bank_folder((select id from t_fb));
  end $d$;$$,
  '22. empty folder delete after clearing questions + subfolder'
);

-- Large batch (>50): prove not page-capped at 50
create temporary table t_large (id uuid);
grant select, insert on t_large to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
delete from t_fa;
insert into t_fa (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Bulk Large A');
delete from t_fb;
insert into t_fb (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Bulk Large B');
delete from t_sa;
insert into t_sa (id)
select public.admin_create_mcq_bank_subfolder((select id from t_fa), 'Bulk Large Sub A');
delete from t_sb;
insert into t_sb (id)
select public.admin_create_mcq_bank_subfolder((select id from t_fb), 'Bulk Large Sub B');

do $$
declare
  i int;
  v_id uuid;
  v_opts jsonb := '[{"key":"A","text":"A"},{"key":"B","text":"B"},{"key":"C","text":"C"},{"key":"D","text":"D"}]'::jsonb;
begin
  for i in 1..60 loop
    v_id := public.create_question(
      (select topic_id from curriculum),
      'Large Bulk MCQ ' || i || ' ' || gen_random_uuid()::text,
      v_opts,
      'A',
      '',
      '',
      'easy',
      '{}',
      'draft',
      (select id from t_sa)
    );
    insert into t_large (id) values (v_id);
  end loop;
end;
$$;

select ok(
  (select (public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    null,
    true
  ) ->> 'moved')::int = 60),
  '23. bulk move 60 questions in one call (not limited to 50)'
);

select ok(
  (select (public.admin_bulk_soft_delete_subfolder_questions(
    (select id from t_sb),
    null,
    true
  ) ->> 'binned')::int = 60),
  '24. bulk soft-delete 60 questions in one call'
);

select * from finish();
rollback;
