-- MCQ Bank PDF allocate for edit_questions (folder-scoped) + soft-delete empty contract.
begin;
select plan(15);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_admin('MCQ PDF Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'MCQ PDF EditQ',
  array['edit_questions']
) as id into temp t_edit;
select test_helpers.make_limited_admin(
  'MCQ PDF EditQ WrongYear',
  array['edit_questions']
) as id into temp t_edit_wrong;
select test_helpers.make_limited_admin(
  'MCQ PDF Zero',
  '{}'
) as id into temp t_zero;
select test_helpers.make_limited_admin(
  'MCQ PDF Mats',
  array['manage_materials']
) as id into temp t_mats;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

select id into temp t_folder
  from public.mcq_bank_folders
  where academic_product_subject_id = (select id from t_block1)
    and deleted_at is null
  order by sort_order, name
  limit 1;

grant select on curriculum, t_year2, t_main, t_edit, t_edit_wrong, t_zero, t_mats,
  t_block1, t_folder
  to anon, authenticated;

-- Prefabricate temp holder as runner (staging auth cannot CREATE TEMP mid-impersonation)
create temporary table t_empty_folder (id uuid);
grant select, insert on t_empty_folder to anon, authenticated;

select test_helpers.as_user((select id from t_main));
insert into t_empty_folder (id)
select public.admin_create_mcq_bank_folder(
  (select id from t_block1),
  'Empty PDF Gate Folder'
);

select test_helpers.as_runner();
select material_folder_id as id into temp t_mat_folder
  from public.mcq_bank_folders
  where id = (select id from t_folder);

select material_folder_id as id into temp t_empty_mat
  from public.mcq_bank_folders
  where id = (select id from t_empty_folder);

grant select on t_mat_folder, t_empty_mat
  to anon, authenticated;

-- Year assignments
select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_edit),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_edit_wrong),
  array[(select id from t_year2)]
);
select public.set_admin_year_assignments(
  (select id from t_mats),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_zero),
  array[(select year_id from curriculum)]
);

------------------------------------------------------------------
-- allocate_study_object_key scoping
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select ok(
  public.allocate_study_object_key((select id from t_mat_folder))
    like 'study-content/%',
  'main admin can allocate for mcq_bank material folder'
);

select ok(
  public.allocate_study_object_key() like 'study-content/%',
  'main admin can allocate with null folder (manage_materials path)'
);

select test_helpers.as_user((select id from t_edit));
select ok(
  public.allocate_study_object_key((select id from t_mat_folder))
    like 'study-content/%',
  'edit_questions + assigned class can allocate for mcq_bank folder'
);

select throws_ok(
  $$select public.allocate_study_object_key()$$,
  'P0001',
  'permission_denied',
  'edit_questions cannot allocate without folder (no global weaken)'
);

select test_helpers.as_user((select id from t_zero));
select throws_ok(
  $$select public.allocate_study_object_key((select id from t_mat_folder))$$,
  'P0001',
  'permission_denied',
  'unauthorized admin cannot allocate for mcq_bank folder'
);

select test_helpers.as_user((select id from t_edit_wrong));
select throws_ok(
  $$select public.allocate_study_object_key((select id from t_mat_folder))$$,
  'P0001',
  'permission_denied',
  'edit_questions on wrong class cannot allocate for curriculum mcq_bank folder'
);

select test_helpers.as_user((select id from t_mats));
select ok(
  public.allocate_study_object_key((select id from t_mat_folder))
    like 'study-content/%',
  'manage_materials can still allocate for mcq_bank folder'
);

select ok(
  public.can_admin_manage_mcq_bank_material_folder((select id from t_mat_folder))
    = false,
  'manage_materials alone does not set can_admin_manage_mcq_bank_material_folder'
);

select test_helpers.as_user((select id from t_edit));
select ok(
  public.can_admin_manage_mcq_bank_material_folder((select id from t_mat_folder)),
  'edit_questions + year sets can_admin_manage_mcq_bank_material_folder'
);

------------------------------------------------------------------
-- soft-delete empty contract: questions / PDFs / both / empty
------------------------------------------------------------------
select test_helpers.as_runner();

-- PDF-only folder: empty questions, one live PDF on shadow material folder
insert into public.materials (
  folder_id, title, kind, status, sort_order,
  r2_object_key, file_type
) values (
  (select id from t_empty_mat),
  'Gate PDF',
  'pdf',
  'published',
  1,
  'study-content/tenant/admin/mcq-gate-pdf',
  'pdf'
);

select test_helpers.as_user((select id from t_edit));
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_empty_folder))$$,
  'P0001',
  'folder_not_empty',
  'soft-delete refuses when live PDFs exist (questions=0)'
);

select is(
  (
    select pdf_count::int
    from public.admin_list_mcq_bank_folders((select id from t_block1))
    where folder_id = (select id from t_empty_folder)
  ),
  1,
  'admin_list reports pdf_count=1 for PDF-only folder'
);

-- Remove PDF → genuinely empty → delete succeeds
select test_helpers.as_runner();
update public.materials
set deleted_at = now(), purge_after = now() + interval '7 days'
where folder_id = (select id from t_empty_mat)
  and deleted_at is null;

select test_helpers.as_user((select id from t_edit));
select lives_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_empty_folder))$$,
  'soft-delete succeeds for genuinely empty folder'
);

-- Questions-only: assign a question to seed folder (no live PDFs yet)
select test_helpers.as_runner();
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_q1;
update public.questions set status = 'approved' where id = (select id from t_q1);
grant select on t_q1 to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
create temporary table t_sf (id uuid);
grant select, insert on t_sf to anon, authenticated;
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), '214 SoftDel Sub');
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q1),
  (select id from t_sf)
);

select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_folder))$$,
  'P0001',
  'folder_not_empty',
  'soft-delete refuses when questions exist (PDFs=0)'
);

-- Both: add a live PDF while question remains
select test_helpers.as_runner();
insert into public.materials (
  folder_id, title, kind, status, sort_order,
  r2_object_key, file_type
) values (
  (select id from t_mat_folder),
  'Both Gate PDF',
  'pdf',
  'published',
  1,
  'study-content/tenant/admin/mcq-both-pdf',
  'pdf'
);

select test_helpers.as_user((select id from t_edit));
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_folder))$$,
  'P0001',
  'folder_not_empty',
  'soft-delete refuses when questions and PDFs both exist'
);

select ok(
  (
    select question_count > 0 and pdf_count > 0
    from public.admin_list_mcq_bank_folders((select id from t_block1))
    where folder_id = (select id from t_folder)
  ),
  'admin_list reports both question_count and pdf_count > 0'
);

select * from finish();
rollback;
