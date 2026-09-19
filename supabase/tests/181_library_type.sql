-- material_folders.library_type: library category distinct from materials.kind
begin;
select plan(5);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

select has_column(
  'public',
  'material_folders',
  'library_type',
  'library_type column exists'
);

select col_not_null(
  'material_folders',
  'library_type',
  'library_type is required'
);

insert into public.material_folders (year_id, name, entitlement)
values ((select year_id from curriculum), 'Default notes folder', 'free');

select is(
  (
    select library_type
    from public.material_folders
    where name = 'Default notes folder'
    order by created_at desc
    limit 1
  ),
  'notes',
  'new folders default to notes'
);

select lives_ok(
  $$insert into public.material_folders (year_id, name, library_type)
    values ((select year_id from curriculum), 'Books folder', 'books')$$,
  'books library_type is allowed'
);

select throws_matching(
  $$insert into public.material_folders (year_id, name, library_type)
    values ((select year_id from curriculum), 'Bad type', 'video')$$,
  'material_folders_library_type_check',
  'invalid library_type is rejected'
);

select finish();
rollback;
