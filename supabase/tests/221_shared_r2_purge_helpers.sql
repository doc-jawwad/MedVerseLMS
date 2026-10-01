-- Shared R2 reference helpers: refcount gate before enqueue.
begin;
select plan(6);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Shared R2 Helper Admin') as id into temp t_admin;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
where id = (select id from t_admin);

with ins as (
  insert into public.material_folders (
    name, year_id, subject_id, library_type, entitlement
  )
  select
    'Shared Helper Folder',
    (select year_id from curriculum),
    (select id from public.subjects
     where year_id = (select year_id from curriculum) and product_key = 'block-1' limit 1),
    'notes',
    'free'
  returning id
)
select id into temp t_folder from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  )
  select
    (select id from t_folder),
    'Shared Helper Ref PDF',
    'pdf',
    'published',
    'study-content/shared-helper-test/referenced.bin',
    'application/pdf',
    100
  returning id
)
select id into temp t_mat from ins;

grant select on curriculum, t_admin, t_folder, t_mat to anon, authenticated;

-- Unreferenced key → enqueue
select is(
  public.r2_object_still_referenced(
    'study-content/shared-helper-test/unreferenced.bin'
  ),
  false,
  'unknown key is not referenced'
);

select public.enqueue_r2_purge_if_unreferenced(
  'study-content/shared-helper-test/unreferenced.bin',
  'material',
  gen_random_uuid()
);

select is(
  (
    select count(*)::int from public.r2_purge_queue
    where object_key = 'study-content/shared-helper-test/unreferenced.bin'
      and completed_at is null
  ),
  1,
  'unreferenced key is enqueued'
);

-- Referenced material key → skip enqueue
select is(
  public.r2_object_still_referenced(
    'study-content/shared-helper-test/referenced.bin'
  ),
  true,
  'material r2_object_key is referenced'
);

select public.enqueue_r2_purge_if_unreferenced(
  'study-content/shared-helper-test/referenced.bin',
  'material',
  (select id from t_mat)
);

select is(
  (
    select count(*)::int from public.r2_purge_queue
    where object_key = 'study-content/shared-helper-test/referenced.bin'
      and completed_at is null
  ),
  0,
  'referenced key is not enqueued'
);

-- After clearing the material reference, enqueue is allowed
update public.materials
set r2_object_key = null
where id = (select id from t_mat);

select is(
  public.r2_object_still_referenced(
    'study-content/shared-helper-test/referenced.bin'
  ),
  false,
  'cleared material key is no longer referenced'
);

select public.enqueue_r2_purge_if_unreferenced(
  'study-content/shared-helper-test/referenced.bin',
  'material',
  (select id from t_mat)
);

select is(
  (
    select count(*)::int from public.r2_purge_queue
    where object_key = 'study-content/shared-helper-test/referenced.bin'
      and completed_at is null
  ),
  1,
  'cleared key is enqueued'
);

select * from finish();
rollback;
