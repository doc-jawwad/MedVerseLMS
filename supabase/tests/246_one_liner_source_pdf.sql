-- Optional source PDF on one_liners: grants, authorize, admin RPC, purge enqueue.

begin;
select plan(12);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'OL PDF Student') as id
  into temp t_student;
select test_helpers.make_admin('OL PDF Admin') as id into temp t_admin;

grant select on curriculum, t_student, t_admin to anon, authenticated;

insert into public.enrollments (student_id, year_id, status)
values ((select id from t_student), (select year_id from curriculum), 'active')
on conflict do nothing;

select test_helpers.as_user((select id from t_admin));
select public.create_one_liner(
  p_year_id => (select year_id from curriculum),
  p_subject_id => (select subject_id from curriculum),
  p_title => 'OL with PDF',
  p_body => 'Body',
  p_status => 'published'
) AS column1 into temp t_liner_id;
grant select on t_liner_id to anon, authenticated;

-- Attach PDF columns as admin (table UPDATE; SELECT of r2_* denied to authenticated)
update public.one_liners
set
  r2_object_key = 'study-content/test/one-liner-pdf.pdf',
  r2_content_type = 'application/pdf',
  r2_byte_size = 1234
where id = (select column1 from t_liner_id limit 1);

select ok(
  (select has_source_pdf from public.one_liners where id = (select column1 from t_liner_id limit 1)),
  '1. has_source_pdf true when r2_object_key set'
);

select ok(
  not has_column_privilege('authenticated', 'public.one_liners', 'r2_object_key', 'select')
  and not has_column_privilege('authenticated', 'public.one_liners', 'r2_content_type', 'select')
  and not has_column_privilege('authenticated', 'public.one_liners', 'r2_byte_size', 'select'),
  '2. authenticated cannot SELECT r2_* columns'
);

select ok(
  has_column_privilege('authenticated', 'public.one_liners', 'has_source_pdf', 'select'),
  '3. authenticated can SELECT has_source_pdf'
);

select test_helpers.as_user((select id from t_student));
select is(
  public.authorize_one_liner_object((select column1 from t_liner_id limit 1)),
  'study-content/test/one-liner-pdf.pdf',
  '4. enrolled student can authorize published one_liner PDF'
);

select ok(
  (select has_source_pdf from public.one_liners where id = (select column1 from t_liner_id limit 1)),
  '5. student catalog can read has_source_pdf'
);

select test_helpers.as_user((select id from t_admin));
update public.one_liners
set status = 'draft'
where id = (select column1 from t_liner_id limit 1);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    $$ select public.authorize_one_liner_object(%L::uuid) $$,
    (select column1::text from t_liner_id limit 1)
  ),
  'P0001',
  'one_liner_object_denied',
  '6. student cannot authorize draft one_liner PDF'
);

select test_helpers.as_user((select id from t_admin));
update public.one_liners
set status = 'published'
where id = (select column1 from t_liner_id limit 1);

select is(
  public.authorize_one_liner_object((select column1 from t_liner_id limit 1)),
  'study-content/test/one-liner-pdf.pdf',
  '7. admin can authorize one_liner PDF'
);

select ok(
  (public.get_one_liner_for_admin((select column1 from t_liner_id limit 1)) ->> 'r2_object_key')
    = 'study-content/test/one-liner-pdf.pdf',
  '8. get_one_liner_for_admin returns r2_object_key'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    $$ select public.get_one_liner_for_admin(%L::uuid) $$,
    (select column1::text from t_liner_id limit 1)
  ),
  'P0001',
  'permission_denied',
  '9. student cannot call get_one_liner_for_admin'
);

-- Soft-delete + purge enqueues when unreferenced
select test_helpers.as_user((select id from t_admin));
select public.soft_delete_content(
  'one_liner',
  (select column1 from t_liner_id limit 1)
);

select throws_ok(
  format(
    $$ select public.authorize_one_liner_object(%L::uuid) $$,
    (select column1::text from t_liner_id limit 1)
  ),
  'P0001',
  'one_liner_object_denied',
  '10. authorize refuses soft-deleted one_liner'
);

select public.purge_content(
  'one_liner',
  (select column1 from t_liner_id limit 1)
);

select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.r2_purge_queue
    where object_key = 'study-content/test/one-liner-pdf.pdf'
      and entity_type = 'one_liner'
  ),
  '11. purge_content enqueues one_liner R2 key'
);

select ok(
  public.r2_object_still_referenced('study-content/test/one-liner-pdf.pdf') = false,
  '12. after purge, key is no longer referenced'
);

select * from finish();
rollback;
