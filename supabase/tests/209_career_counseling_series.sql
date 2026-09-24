-- Career Counseling Series library_type (independent of other_services)
begin;
select plan(4);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

select lives_ok(
  $$insert into public.material_folders (year_id, name, library_type, description)
    values (
      (select year_id from curriculum),
      'USMLE pathway',
      'career_counseling_series',
      'Session notes'
    )$$,
  'career_counseling_series library_type is allowed'
);

select is(
  (
    select description from public.material_folders
    where name = 'USMLE pathway' and library_type = 'career_counseling_series'
    order by created_at desc limit 1
  ),
  'Session notes',
  'career_counseling_series description is stored'
);

select lives_ok(
  $$insert into public.materials (
      folder_id, title, kind, status, file_type,
      r2_object_key, r2_content_type, r2_byte_size
    )
    values (
      (select id from public.material_folders
        where name = 'USMLE pathway' and library_type = 'career_counseling_series'
        order by created_at desc limit 1),
      'Guide.pdf', 'pdf', 'published', 'pdf',
      'study-content/test/career-guide.pdf', 'application/pdf', 2048
    )$$,
  'PDF on career_counseling_series folder is allowed'
);

select throws_ok(
  $$insert into public.material_folders (year_id, name, library_type)
    values ((select year_id from curriculum), 'Bad', 'career_counselling')$$,
  '23514',
  null,
  'legacy British spelling library_type is rejected'
);

select * from finish();
rollback;
