-- Academic MCQ Bank subfolders: CRUD, year inheritance, soft-delete, year scope.
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

-- 4–5. empty subfolder OK; soft-delete empty OK
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

select lives_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf_empty))$$,
  '5. soft-delete empty subfolder succeeds'
);

-- 6–7. refuse delete with live questions
select test_helpers.as_runner();
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_q1;
update public.questions set status = 'approved' where id = (select id from t_q1);
grant select on t_q1 to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q1),
  (select id from t_sf)
);

select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf))$$,
  'P0001',
  'subfolder_not_empty',
  '6. soft-delete refuses when live questions remain'
);

-- 8. folder soft-delete refuses while live subfolder exists
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_folder))$$,
  'P0001',
  'folder_not_empty',
  '7. folder soft-delete refuses while live subfolder exists'
);

-- 9. remove question then soft-delete subfolder; folder still blocked if another empty? only one live
select public.admin_remove_question_from_mcq_bank_subfolder((select id from t_q1));
select lives_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf))$$,
  '8. soft-delete succeeds after clearing questions'
);

-- recreate one live empty subfolder to keep folder non-empty for year-scope checks
delete from t_sf;
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder(
  (select id from t_folder),
  'Subfold Scoped'
);

-- 10–11. isolation / admin year scope
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
  'year_scope_denied',
  '10. wrong-year admin cannot soft-delete subfolder'
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

-- folder still refuses while live (empty) subfolder remains
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_folder))$$,
  'P0001',
  'folder_not_empty',
  '14. folder soft-delete still refuses with live empty subfolder'
);

select * from finish();
rollback;
