-- Notes PDF Move: identity/R2 preservation + year/library/surface/permission seals.
begin;
select plan(14);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_admin('NotesMove Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'NotesMove Mats',
  array['manage_materials']
) as id into temp t_mats;
select test_helpers.make_limited_admin(
  'NotesMove WrongYear',
  array['manage_materials']
) as id into temp t_wrong;
select test_helpers.make_limited_admin(
  'NotesMove NoPerm',
  array['edit_questions']
) as id into temp t_noperm;

grant select on curriculum, t_year2, t_main, t_mats, t_wrong, t_noperm
  to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_mats),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_wrong),
  array[(select id from t_year2)]
);
select public.set_admin_year_assignments(
  (select id from t_noperm),
  array[(select year_id from curriculum)]
);

select test_helpers.as_runner();

-- Source + dest Notes folders (same year, academic)
with ins as (
  insert into public.material_folders (
    name, year_id, library_type, content_surface, entitlement
  ) values (
    'NotesMove A',
    (select year_id from curriculum),
    'notes',
    'academic',
    'free'
  )
  returning id
)
select id into temp t_fa from ins;

with ins as (
  insert into public.material_folders (
    name, year_id, library_type, content_surface, entitlement
  ) values (
    'NotesMove B',
    (select year_id from curriculum),
    'notes',
    'academic',
    'free'
  )
  returning id
)
select id into temp t_fb from ins;

-- Wrong library_type destination
with ins as (
  insert into public.material_folders (
    name, year_id, library_type, content_surface, entitlement
  ) values (
    'NotesMove Books',
    (select year_id from curriculum),
    'books',
    'academic',
    'free'
  )
  returning id
)
select id into temp t_books from ins;

-- Wrong year Notes folder
with ins as (
  insert into public.material_folders (
    name, year_id, library_type, content_surface, entitlement
  ) values (
    'NotesMove Y2',
    (select id from t_year2),
    'notes',
    'academic',
    'free'
  )
  returning id
)
select id into temp t_fy2 from ins;

-- Wrong content_surface
with ins as (
  insert into public.material_folders (
    name, year_id, library_type, content_surface, entitlement
  ) values (
    'NotesMove PS',
    (select year_id from curriculum),
    'notes',
    'prof_session',
    'free'
  )
  returning id
)
select id into temp t_ps from ins;

-- Soft-deleted destination
with ins as (
  insert into public.material_folders (
    name, year_id, library_type, content_surface, entitlement, deleted_at, purge_after
  ) values (
    'NotesMove Bin',
    (select year_id from curriculum),
    'notes',
    'academic',
    'free',
    now(),
    now() + interval '7 days'
  )
  returning id
)
select id into temp t_bin_folder from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  ) values (
    (select id from t_fa),
    'NotesMove PDF',
    'pdf',
    'published',
    'study-content/notes-move/fixture.pdf',
    'application/pdf',
    2048
  )
  returning id
)
select id into temp t_mat from ins;

select r2_object_key into temp t_key from public.materials where id = (select id from t_mat);

grant select on t_fa, t_fb, t_books, t_fy2, t_ps, t_bin_folder, t_mat, t_key
  to anon, authenticated;

-- A. happy path preserves id + r2 key, changes folder only
select test_helpers.as_user((select id from t_mats));
select ok(
  (select (public.admin_move_notes_pdf_material(
    (select id from t_mat),
    (select id from t_fb)
  )->>'material_id') = (select id::text from t_mat)),
  'A1. material id preserved'
);
select is(
  (select folder_id from public.materials where id = (select id from t_mat)),
  (select id from t_fb),
  'A2. folder_id updated'
);
select is(
  (select r2_object_key from public.materials where id = (select id from t_mat)),
  (select r2_object_key from t_key),
  'A3. r2_object_key unchanged'
);
select ok(
  (select deleted_at is null from public.materials where id = (select id from t_mat)),
  'A4. not binned'
);

-- B. wrong library type
select throws_ok(
  format(
    $$select public.admin_move_notes_pdf_material(%L::uuid, %L::uuid)$$,
    (select id from t_mat),
    (select id from t_books)
  ),
  'P0001',
  'notes_move_library_type_mismatch',
  'B. reject books destination'
);

-- C. wrong year
select throws_ok(
  format(
    $$select public.admin_move_notes_pdf_material(%L::uuid, %L::uuid)$$,
    (select id from t_mat),
    (select id from t_fy2)
  ),
  'P0001',
  'notes_move_year_mismatch',
  'C. reject cross-year destination'
);

-- D. wrong content surface
select throws_ok(
  format(
    $$select public.admin_move_notes_pdf_material(%L::uuid, %L::uuid)$$,
    (select id from t_mat),
    (select id from t_ps)
  ),
  'P0001',
  'notes_move_content_surface_mismatch',
  'D. reject content_surface mismatch'
);

-- E. deleted destination
select throws_ok(
  format(
    $$select public.admin_move_notes_pdf_material(%L::uuid, %L::uuid)$$,
    (select id from t_mat),
    (select id from t_bin_folder)
  ),
  'P0001',
  'destination_folder_deleted',
  'E. reject deleted destination'
);

-- F. insufficient permission
select test_helpers.as_user((select id from t_noperm));
select throws_ok(
  format(
    $$select public.admin_move_notes_pdf_material(%L::uuid, %L::uuid)$$,
    (select id from t_mat),
    (select id from t_fa)
  ),
  'P0001',
  'permission_denied',
  'F. reject without manage_materials'
);

-- G. year scope denied (assigned to other year)
select test_helpers.as_user((select id from t_wrong));
select throws_ok(
  format(
    $$select public.admin_move_notes_pdf_material(%L::uuid, %L::uuid)$$,
    (select id from t_mat),
    (select id from t_fa)
  ),
  'P0001',
  'year_scope_denied',
  'G. reject wrong year assignment'
);

-- H. move back (still no bin / key change) + r2_purge_queue untouched for this key
select test_helpers.as_user((select id from t_mats));
select ok(
  (select (public.admin_move_notes_pdf_material(
    (select id from t_mat),
    (select id from t_fa)
  )->>'folder_id') = (select id::text from t_fa)),
  'H1. move back to source'
);
select is(
  (select r2_object_key from public.materials where id = (select id from t_mat)),
  (select r2_object_key from t_key),
  'H2. r2 key still unchanged after second move'
);
select is(
  (select count(*)::int from public.r2_purge_queue
   where object_key = (select r2_object_key from t_key)
     and completed_at is null),
  0,
  'H3. no open r2 purge for this key'
);
select ok(
  (select deleted_at is null from public.materials where id = (select id from t_mat)),
  'H4. still not binned'
);

select * from finish();
rollback;
