-- Content Bin: folder hard-delete refuses live descendants;
-- subtree R2 keys captured before CASCADE; exclusive keys enqueued after;
-- shared keys remain when an outside live holder still references them.
begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Bin LiveDesc Admin') as id into temp t_admin;

update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
where id = (select id from t_admin);

with ins as (
  insert into public.material_folders (
    name, year_id, subject_id, library_type, entitlement
  )
  select
    'LiveDesc Parent',
    (select year_id from curriculum),
    (select id from public.subjects
     where year_id = (select year_id from curriculum) and product_key = 'block-1' limit 1),
    'notes',
    'free'
  returning id
)
select id into temp t_parent from ins;

with ins as (
  insert into public.material_folders (
    name, year_id, subject_id, library_type, entitlement, parent_id
  )
  select
    'LiveDesc Child',
    (select year_id from curriculum),
    (select id from public.subjects
     where year_id = (select year_id from curriculum) and product_key = 'block-1' limit 1),
    'notes',
    'free',
    (select id from t_parent)
  returning id
)
select id into temp t_child from ins;

-- Sibling folder OUTSIDE the purged tree (holds shared R2 key)
with ins as (
  insert into public.material_folders (
    name, year_id, subject_id, library_type, entitlement
  )
  select
    'LiveDesc External',
    (select year_id from curriculum),
    (select id from public.subjects
     where year_id = (select year_id from curriculum) and product_key = 'block-1' limit 1),
    'notes',
    'free'
  returning id
)
select id into temp t_external from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  )
  select
    (select id from t_child),
    'Nested Unique PDF',
    'pdf',
    'published',
    'study-content/livedesc/unique-nested',
    'application/pdf',
    42
  returning id
)
select id into temp t_mat from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  )
  select
    (select id from t_child),
    'Nested Shared PDF',
    'pdf',
    'published',
    'study-content/livedesc/shared-key',
    'application/pdf',
    99
  returning id
)
select id into temp t_shared_mat from ins;

insert into public.materials (
  folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
)
select
  (select id from t_external),
  'External Shared Holder',
  'pdf',
  'published',
  'study-content/livedesc/shared-key',
  'application/pdf',
  99;

grant select on curriculum, t_admin, t_parent, t_child, t_external, t_mat, t_shared_mat
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));

-- Soft-delete parent only; child still live → purge must refuse
select public.soft_delete_content('material_folder', (select id from t_parent));

select throws_ok(
  format(
    $q$select public.purge_content('material_folder', %L::uuid)$q$,
    (select id from t_parent)
  ),
  'P0001',
  'folder_has_live_descendants',
  'purge parent refuses while live child exists'
);

select is(
  public.folder_has_live_descendants((select id from t_parent)),
  true,
  'parent reports live descendants'
);

-- Soft-delete nested materials + child folder; external shared holder stays live
select public.soft_delete_content('material', (select id from t_mat));
select public.soft_delete_content('material', (select id from t_shared_mat));
select public.soft_delete_content('material_folder', (select id from t_child));

select is(
  public.folder_has_live_descendants((select id from t_parent)),
  false,
  'parent has no live descendants after soft-delete'
);

select test_helpers.as_runner();
select ok(
  'study-content/livedesc/unique-nested' = any (
    public.folder_subtree_r2_keys((select id from t_parent))
  ),
  'subtree R2 keys include nested soft-deleted unique material'
);
select ok(
  'study-content/livedesc/shared-key' = any (
    public.folder_subtree_r2_keys((select id from t_parent))
  ),
  'subtree R2 keys include nested soft-deleted shared material'
);

-- Folder CASCADE alone (do not purge nested materials first) must:
-- 1) enqueue exclusive nested key
-- 2) leave shared key alone while external live holder remains
select test_helpers.as_user((select id from t_admin));
select public.purge_content('material_folder', (select id from t_parent));

select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.r2_purge_queue
    where object_key = 'study-content/livedesc/unique-nested'
      and completed_at is null
  ),
  'CASCADE folder purge enqueues exclusive nested R2 key'
);

select ok(
  not exists (
    select 1 from public.r2_purge_queue
    where object_key = 'study-content/livedesc/shared-key'
      and completed_at is null
  ),
  'shared R2 key not enqueued while external live holder remains'
);

select is(
  (select count(*)::int from public.material_folders
   where id in ((select id from t_parent), (select id from t_child))),
  0,
  'parent and child folders hard-deleted'
);

select is(
  (select count(*)::int from public.materials
   where id in ((select id from t_mat), (select id from t_shared_mat))),
  0,
  'nested materials hard-deleted via CASCADE'
);

select ok(
  exists (
    select 1 from public.materials
    where folder_id = (select id from t_external)
      and r2_object_key = 'study-content/livedesc/shared-key'
      and deleted_at is null
  ),
  'external shared holder remains live'
);

select * from finish();
rollback;
