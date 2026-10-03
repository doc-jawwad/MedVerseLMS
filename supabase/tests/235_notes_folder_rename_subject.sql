-- Notes folder Rename + Change Subject seals.
begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_admin('NotesFolder Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'NotesFolder Mats',
  array['manage_materials']
) as id into temp t_mats;
select test_helpers.make_limited_admin(
  'NotesFolder NoPerm',
  array['edit_questions']
) as id into temp t_noperm;

grant select on curriculum, t_year2, t_main, t_mats, t_noperm
  to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_mats),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_noperm),
  array[(select year_id from curriculum)]
);

select test_helpers.as_runner();

select id into temp t_subj1
from public.subjects
where year_id = (select year_id from curriculum)
order by sort_order, name
limit 1;

select id into temp t_subj2
from public.subjects
where year_id = (select year_id from curriculum)
  and id <> (select id from t_subj1)
order by sort_order, name
limit 1;

-- Ensure year2 subject
insert into public.subjects (year_id, name, product_key)
select (select id from t_year2), 'NotesFolder Y2 Subj', 'block-1'
where not exists (
  select 1 from public.subjects
  where year_id = (select id from t_year2) and product_key = 'block-1'
);
select id into temp t_subj_y2
from public.subjects
where year_id = (select id from t_year2)
order by sort_order, name
limit 1;

with ins as (
  insert into public.material_folders (
    name, year_id, subject_id, library_type, content_surface, entitlement
  ) values (
    'NotesFolder A',
    (select year_id from curriculum),
    (select id from t_subj1),
    'notes',
    'academic',
    'free'
  )
  returning id
)
select id into temp t_folder from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  ) values (
    (select id from t_folder),
    'NotesFolder PDF',
    'pdf',
    'published',
    'study-content/notes-folder-edit/fixture.pdf',
    'application/pdf',
    1024
  )
  returning id, r2_object_key
)
select id, r2_object_key into temp t_mat from ins;

grant select on t_subj1, t_subj2, t_subj_y2, t_folder, t_mat
  to anon, authenticated;

select test_helpers.as_user((select id from t_mats));

-- A. rename
select is(
  (select public.admin_update_notes_folder(
    (select id from t_folder), 'NotesFolder Renamed', null
  )->>'name'),
  'NotesFolder Renamed',
  'A. rename succeeds'
);

-- B. change subject (same year)
select is(
  (select public.admin_update_notes_folder(
    (select id from t_folder), null, (select id from t_subj2)
  )->>'subject_id'),
  (select id::text from t_subj2),
  'B. change subject same year'
);

-- C. material placement + r2 unchanged
select is(
  (select folder_id from public.materials where id = (select id from t_mat)),
  (select id from t_folder),
  'C1. material folder_id unchanged'
);
select is(
  (select r2_object_key from public.materials where id = (select id from t_mat)),
  (select r2_object_key from t_mat),
  'C2. r2 key unchanged'
);
select ok(
  (select deleted_at is null from public.material_folders where id = (select id from t_folder)),
  'C3. folder not binned'
);

-- D. reject cross-year subject
select throws_ok(
  format(
    $$select public.admin_update_notes_folder(%L::uuid, null, %L::uuid)$$,
    (select id from t_folder),
    (select id from t_subj_y2)
  ),
  'P0001',
  'notes_folder_subject_year_mismatch',
  'D. reject cross-year subject'
);

-- E. reject empty name
select throws_ok(
  format(
    $$select public.admin_update_notes_folder(%L::uuid, '   ', null)$$,
    (select id from t_folder)
  ),
  'P0001',
  'folder_name_required',
  'E. reject blank name'
);

-- F. permission denied
select test_helpers.as_user((select id from t_noperm));
select throws_ok(
  format(
    $$select public.admin_update_notes_folder(%L::uuid, 'Nope', null)$$,
    (select id from t_folder)
  ),
  'P0001',
  'permission_denied',
  'F. reject without manage_materials'
);

-- G. year/library/surface unchanged after edits
select test_helpers.as_user((select id from t_mats));
select ok(
  (select year_id = (select year_id from curriculum)
     and library_type = 'notes'
     and content_surface = 'academic'
   from public.material_folders where id = (select id from t_folder)),
  'G. year/library/surface preserved'
);

select is(
  (select count(*)::int from public.r2_purge_queue
   where object_key = (select r2_object_key from t_mat)
     and completed_at is null),
  0,
  'H. no r2 purge'
);

select * from finish();
rollback;
