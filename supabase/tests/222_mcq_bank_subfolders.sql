-- Academic MCQ Bank subfolders: CRUD, year inheritance, Main-Admin cascade soft-delete.
begin;
select plan(14);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_admin('Subfold Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'Subfold Edit',
  array['edit_questions']
) as id into temp t_edit;
select test_helpers.make_limited_admin(
  'Subfold WrongYear',
  array['edit_questions']
) as id into temp t_wrong;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

grant select on curriculum, t_year2, t_main, t_edit, t_wrong, t_block1
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

create temporary table t_folder (id uuid);
create temporary table t_sf (id uuid);
create temporary table t_sf_empty (id uuid);
grant select, insert on t_folder, t_sf, t_sf_empty to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
insert into t_folder (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Subfold Parent');

-- 1. create subfolder under folder
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder(
  (select id from t_folder),
  'Subfold A'
);

select ok(
  (select count(*)::int from public.mcq_bank_subfolders
   where id = (select id from t_sf) and deleted_at is null) = 1,
  '1. create subfolder under folder'
);

-- 2. year inheritance from parent folder
select is(
  (select year_id from public.mcq_bank_subfolders where id = (select id from t_sf)),
  (select year_id from public.mcq_bank_folders where id = (select id from t_folder)),
  '2. subfolder year_id inherits from parent folder'
);

select is(
  (select academic_product_subject_id from public.mcq_bank_subfolders
   where id = (select id from t_sf)),
  (select id from t_block1),
  '3. subfolder product subject inherits from parent'
);

-- 4. empty subfolder listed
insert into t_sf_empty (id)
select public.admin_create_mcq_bank_subfolder(
  (select id from t_folder),
  'Subfold Empty'
);

select is(
  (select count(*)::int from public.admin_list_mcq_bank_subfolders((select id from t_folder))
   where subfolder_id = (select id from t_sf_empty) and question_count = 0),
  1,
  '4. empty subfolder listed with question_count=0'
);

-- 5. limited admin cannot soft-delete (Main Admin only)
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf_empty))$$,
  'P0001',
  'permission_denied',
  '5. limited admin cannot soft-delete subfolder'
);

-- 6. Main Admin soft-delete empty subfolder
select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf_empty))$$,
  '6. Main Admin soft-delete empty subfolder succeeds'
);

-- 7. Main Admin cascade soft-delete with live questions
select test_helpers.as_runner();
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_q1;
grant select on t_q1 to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q1),
  (select id from t_sf)
);

select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf))$$,
  '7. Main Admin cascade soft-delete subfolder with questions'
);

select ok(
  (select deleted_at is not null from public.questions where id = (select id from t_q1)),
  '8. cascaded question is soft-deleted'
);

-- recreate live subfolder for remaining checks
select test_helpers.as_user((select id from t_edit));
delete from t_sf;
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder(
  (select id from t_folder),
  'Subfold Scoped'
);

-- 9–10. isolation / admin year scope
select test_helpers.as_user((select id from t_wrong));
select throws_ok(
  $$select public.admin_create_mcq_bank_subfolder(
    (select id from t_folder), 'Wrong Year Sub'
  )$$,
  'P0001',
  'year_scope_denied',
  '9. wrong-year admin cannot create subfolder'
);

select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf))$$,
  'P0001',
  'permission_denied',
  '10. wrong-year / non-main cannot soft-delete subfolder'
);

select test_helpers.as_user((select id from t_edit));
select ok(
  exists (
    select 1 from public.admin_list_mcq_bank_subfolders((select id from t_folder))
    where subfolder_id = (select id from t_sf)
  ),
  '11. scoped admin can list subfolders under folder'
);

select lives_ok(
  $$select public.admin_rename_mcq_bank_subfolder(
    (select id from t_sf), 'Subfold Renamed'
  )$$,
  '12. rename subfolder'
);

select is(
  (select name from public.mcq_bank_subfolders where id = (select id from t_sf)),
  'Subfold Renamed',
  '13. rename persists'
);

-- 14. limited admin cannot cascade-delete folder
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_folder))$$,
  'P0001',
  'permission_denied',
  '14. limited admin cannot soft-delete folder'
);

select * from finish();
rollback;
