-- Admin year isolation seal: authorize_study_object, materials RLS writes,
-- soft_delete_content / restore_content year scope (H1/H2/H3).
begin;
select plan(31);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2;

select test_helpers.make_admin('YearIso Main') as id into temp t_main;
select test_helpers.make_limited_admin('YearIso Mats Y1', array['manage_materials']) as id
  into temp t_mats_y1;
select test_helpers.make_limited_admin('YearIso Mats None', array['manage_materials']) as id
  into temp t_mats_none;
select test_helpers.make_limited_admin('YearIso Edit Y1', array['edit_questions']) as id
  into temp t_edit_y1;
select test_helpers.make_student((select year_id from curriculum), 'YearIso Student') as id
  into temp t_student;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
where id = (select id from t_student);

-- Grant temp tables before any as_user() so authenticated can read fixture ids
grant select on curriculum, t_year2, t_main, t_mats_y1, t_mats_none, t_edit_y1, t_student
  to anon, authenticated;

-- Assign limited materials admin to curriculum year only
select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_mats_y1),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_edit_y1),
  array[(select year_id from curriculum)]
);

select test_helpers.as_runner();

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

-- Ensure year-2 has a product subject for MCQ folder inserts
insert into public.subjects (year_id, name, product_key)
select (select id from t_year2), 'YearIso Y2 Block', 'block-1'
where not exists (
  select 1 from public.subjects
  where year_id = (select id from t_year2) and product_key = 'block-1'
);

select id into temp t_block_y2
  from public.subjects
  where year_id = (select id from t_year2) and product_key = 'block-1'
  limit 1;

-- Year-1 notes folder + PDF + drive
with ins as (
  insert into public.material_folders (
    name, year_id, library_type, entitlement
  ) values (
    'YearIso Y1 Notes',
    (select year_id from curriculum),
    'notes',
    'free'
  )
  returning id
)
select id into temp t_folder_y1 from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  ) values (
    (select id from t_folder_y1),
    'YearIso Y1 PDF',
    'pdf',
    'published',
    'study-content/year-iso/y1.pdf',
    'application/pdf',
    100
  )
  returning id
)
select id into temp t_mat_y1 from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, drive_url
  ) values (
    (select id from t_folder_y1),
    'YearIso Y1 Drive',
    'drive',
    'published',
    'https://drive.google.com/file/d/year-iso-y1'
  )
  returning id
)
select id into temp t_drive_y1 from ins;

-- Year-2 notes folder + PDF
with ins as (
  insert into public.material_folders (
    name, year_id, library_type, entitlement
  ) values (
    'YearIso Y2 Notes',
    (select id from t_year2),
    'notes',
    'free'
  )
  returning id
)
select id into temp t_folder_y2 from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  ) values (
    (select id from t_folder_y2),
    'YearIso Y2 PDF',
    'pdf',
    'published',
    'study-content/year-iso/y2.pdf',
    'application/pdf',
    100
  )
  returning id
)
select id into temp t_mat_y2 from ins;

-- CCS universal folder + PDF (null year)
with ins as (
  insert into public.material_folders (
    name, year_id, library_type, entitlement
  ) values (
    'YearIso CCS',
    null,
    'career_counseling_series',
    'free'
  )
  returning id
)
select id into temp t_folder_ccs from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  ) values (
    (select id from t_folder_ccs),
    'YearIso CCS PDF',
    'pdf',
    'published',
    'study-content/year-iso/ccs.pdf',
    'application/pdf',
    50
  )
  returning id
)
select id into temp t_mat_ccs from ins;

-- MCQ Bank folders for RLS write tests
with ins as (
  insert into public.mcq_bank_folders (year_id, name, academic_product_subject_id)
  values (
    (select year_id from curriculum),
    'YearIso MCQ Y1',
    (select id from t_block1)
  )
  returning id
)
select id into temp t_mcq_y1 from ins;

with ins as (
  insert into public.mcq_bank_folders (year_id, name, academic_product_subject_id)
  values (
    (select id from t_year2),
    'YearIso MCQ Y2',
    (select id from t_block_y2)
  )
  returning id
)
select id into temp t_mcq_y2 from ins;

grant select on t_folder_y1, t_mat_y1, t_drive_y1, t_folder_y2, t_mat_y2,
  t_folder_ccs, t_mat_ccs, t_mcq_y1, t_mcq_y2, t_block1, t_block_y2
  to anon, authenticated;

------------------------------------------------------------------
-- H1: authorize_study_object / open_material
------------------------------------------------------------------
select test_helpers.as_user((select id from t_mats_y1));
select is(
  public.authorize_study_object((select id from t_mat_y1)),
  'study-content/year-iso/y1.pdf',
  'H1 assigned materials admin authorizes own-year PDF'
);

select throws_ok(
  $$select public.authorize_study_object((select id from t_mat_y2))$$,
  'study_object_denied',
  'H1 assigned materials admin denied other-year PDF'
);

select is(
  public.open_material((select id from t_drive_y1)),
  'https://drive.google.com/file/d/year-iso-y1',
  'H1 assigned materials admin opens own-year drive material'
);

select is(
  public.authorize_study_object((select id from t_mat_ccs)),
  'study-content/year-iso/ccs.pdf',
  'H1 assigned materials admin authorizes CCS null-year PDF'
);

select test_helpers.as_user((select id from t_mats_none));
select throws_ok(
  $$select public.authorize_study_object((select id from t_mat_y1))$$,
  'study_object_denied',
  'H1 unassigned materials admin denied year-scoped PDF'
);

select is(
  public.authorize_study_object((select id from t_mat_ccs)),
  'study-content/year-iso/ccs.pdf',
  'H1 unassigned materials admin still authorizes CCS'
);

select test_helpers.as_user((select id from t_main));
select is(
  public.authorize_study_object((select id from t_mat_y2)),
  'study-content/year-iso/y2.pdf',
  'H1 main admin authorizes any-year PDF'
);

select test_helpers.as_user((select id from t_student));
select is(
  public.authorize_study_object((select id from t_mat_y1)),
  'study-content/year-iso/y1.pdf',
  'H1 enrolled student still authorizes free own-year PDF'
);

select throws_ok(
  $$select public.authorize_study_object((select id from t_mat_y2))$$,
  'study_object_denied',
  'H1 student denied other-year PDF (entitlement unchanged)'
);

------------------------------------------------------------------
-- H2: materials / MCQ Bank write RLS
------------------------------------------------------------------
select test_helpers.as_user((select id from t_mats_y1));
select lives_ok(
  $$insert into public.materials (
      folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
    ) values (
      (select id from t_folder_y1),
      'YearIso Insert Y1',
      'pdf',
      'draft',
      'study-content/year-iso/insert-y1.pdf',
      'application/pdf',
      10
    )$$,
  'H2 assigned materials admin inserts into own-year folder'
);

select throws_ok(
  $$insert into public.materials (
      folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
    ) values (
      (select id from t_folder_y2),
      'YearIso Insert Y2',
      'pdf',
      'draft',
      'study-content/year-iso/insert-y2.pdf',
      'application/pdf',
      10
    )$$,
  '42501',
  null,
  'H2 assigned materials admin cannot insert into other-year folder'
);

select lives_ok(
  $$update public.materials
    set title = 'YearIso Y1 PDF renamed'
    where id = (select id from t_mat_y1)$$,
  'H2 assigned materials admin updates own-year material'
);

select lives_ok(
  $$update public.materials
    set title = 'hijack'
    where id = (select id from t_mat_y2)$$,
  'H2 cross-year UPDATE does not raise (RLS matches zero rows)'
);

select is(
  (select title from public.materials where id = (select id from t_mat_y2)),
  'YearIso Y2 PDF',
  'H2 assigned materials admin cannot update other-year material'
);

select lives_ok(
  $$delete from public.materials where id = (select id from t_mat_y2)$$,
  'H2 cross-year DELETE does not raise (RLS matches zero rows)'
);

select ok(
  exists (select 1 from public.materials where id = (select id from t_mat_y2)),
  'H2 assigned materials admin cannot delete other-year material'
);

select lives_ok(
  $$insert into public.material_folders (
      name, year_id, library_type, entitlement
    ) values (
      'YearIso CCS Insert',
      null,
      'career_counseling_series',
      'free'
    )$$,
  'H2 materials admin can insert CCS null-year folder'
);

select test_helpers.as_user((select id from t_edit_y1));
select lives_ok(
  $$update public.mcq_bank_folders
    set name = 'YearIso MCQ Y1 renamed'
    where id = (select id from t_mcq_y1)$$,
  'H2 assigned edit_questions updates own-year MCQ folder'
);

select lives_ok(
  $$update public.mcq_bank_folders
    set name = 'hijack'
    where id = (select id from t_mcq_y2)$$,
  'H2 cross-year MCQ UPDATE does not raise (RLS matches zero rows)'
);

select is(
  (select name from public.mcq_bank_folders where id = (select id from t_mcq_y2)),
  'YearIso MCQ Y2',
  'H2 assigned edit_questions cannot update other-year MCQ folder'
);

select throws_ok(
  $$insert into public.mcq_bank_folders (year_id, name, academic_product_subject_id)
    values (
      (select id from t_year2),
      'YearIso MCQ hijack',
      (select id from t_block_y2)
    )$$,
  '42501',
  null,
  'H2 assigned edit_questions cannot insert other-year MCQ folder'
);

select lives_ok(
  $$delete from public.mcq_bank_folders where id = (select id from t_mcq_y2)$$,
  'H2 cross-year MCQ DELETE does not raise (RLS matches zero rows)'
);

select ok(
  exists (select 1 from public.mcq_bank_folders where id = (select id from t_mcq_y2)),
  'H2 assigned edit_questions cannot delete other-year MCQ folder'
);

------------------------------------------------------------------
-- H3: soft_delete_content / restore_content
------------------------------------------------------------------
select test_helpers.as_user((select id from t_mats_y1));
select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_y1))$$,
  'H3 assigned materials admin soft-deletes own-year material'
);

select throws_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_y2))$$,
  'year_scope_denied',
  'H3 assigned materials admin denied soft-delete other-year'
);

select lives_ok(
  $$select public.restore_content('material', (select id from t_mat_y1))$$,
  'H3 assigned materials admin restores own-year material'
);

-- Soft-delete Y2 as main, then limited admin must not restore
select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_y2))$$,
  'H3 main soft-deletes Y2 material for restore bypass probe'
);

select test_helpers.as_user((select id from t_mats_y1));
select throws_ok(
  $$select public.restore_content('material', (select id from t_mat_y2))$$,
  'year_scope_denied',
  'H3 restore cannot bypass year restriction'
);

select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_ccs))$$,
  'H3 materials admin soft-deletes CCS material'
);

select lives_ok(
  $$select public.restore_content('material', (select id from t_mat_ccs))$$,
  'H3 materials admin restores CCS material'
);

select test_helpers.as_user((select id from t_mats_none));
select throws_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_y1))$$,
  'year_scope_denied',
  'H3 unassigned materials admin denied soft-delete year-scoped'
);

select * from finish();
rollback;
