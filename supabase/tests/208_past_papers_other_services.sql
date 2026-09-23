-- Past Papers nesting + Other Services library_type / description
begin;
select plan(8);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

select lives_ok(
  $$insert into public.material_folders (year_id, name, library_type, description)
    values ((select year_id from curriculum), 'OS counselling', 'other_services', 'Talk to advisors')$$,
  'other_services library_type is allowed'
);

select lives_ok(
  $$insert into public.material_folders (year_id, name, library_type)
    values ((select year_id from curriculum), 'First Professional', 'past_papers')$$,
  'past_papers root Sub Nav is allowed'
);

select lives_ok(
  $$insert into public.material_folders (year_id, name, library_type, parent_id)
    values (
      (select year_id from curriculum),
      'Anatomy',
      'past_papers',
      (select id from public.material_folders
        where name = 'First Professional' and library_type = 'past_papers'
        order by created_at desc limit 1)
    )$$,
  'past_papers Sub-Sub Nav via parent_id is allowed'
);

select is(
  (
    select description from public.material_folders
    where name = 'OS counselling' and library_type = 'other_services'
    order by created_at desc limit 1
  ),
  'Talk to advisors',
  'other_services description is stored'
);

select is(
  (
    select parent_id is not null
    from public.material_folders
    where name = 'Anatomy' and library_type = 'past_papers'
    order by created_at desc limit 1
  ),
  true,
  'Sub-Sub Nav has parent_id'
);

select throws_ok(
  $$insert into public.material_folders (year_id, name, library_type)
    values ((select year_id from curriculum), 'Bad', 'not_a_type')$$,
  '23514',
  null,
  'invalid library_type is rejected'
);

-- PDF may attach to Sub Nav or Sub-Sub
select lives_ok(
  $$insert into public.materials (
      folder_id, title, kind, status, file_type,
      r2_object_key, r2_content_type, r2_byte_size
    )
    values (
      (select id from public.material_folders
        where name = 'First Professional' and library_type = 'past_papers'
        order by created_at desc limit 1),
      '2024.pdf', 'pdf', 'published', 'pdf',
      'study-content/test/2024.pdf', 'application/pdf', 1024
    )$$,
  'PDF on Sub Nav is allowed'
);

select lives_ok(
  $$insert into public.materials (
      folder_id, title, kind, status, file_type,
      r2_object_key, r2_content_type, r2_byte_size
    )
    values (
      (select id from public.material_folders
        where name = 'Anatomy' and library_type = 'past_papers'
        order by created_at desc limit 1),
      'Anatomy 2023.pdf', 'pdf', 'draft', 'pdf',
      'study-content/test/anatomy-2023.pdf', 'application/pdf', 2048
    )$$,
  'PDF on Sub-Sub Nav is allowed'
);

select * from finish();
rollback;
