-- Content Bin 7-day retention seal: eligibility, shared R2, access denial.
begin;
select plan(20);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Bin Retention Admin') as id into temp t_admin;
select test_helpers.make_student((select year_id from curriculum), 'Bin Retention Student') as id
  into temp t_student;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
where id = (select id from t_admin);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
where id = (select id from t_student);

with ins as (
  insert into public.material_folders (
    name, year_id, subject_id, library_type, entitlement
  )
  select
    'Retention Folder',
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
    'Retention PDF A',
    'pdf',
    'published',
    'study-content/retention-shared/obj-a',
    'application/pdf',
    100
  returning id
)
select id into temp t_mat_a from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  )
  select
    (select id from t_folder),
    'Retention PDF B',
    'pdf',
    'published',
    'study-content/retention-shared/obj-a',
    'application/pdf',
    100
  returning id
)
select id into temp t_mat_b from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  )
  select
    (select id from t_folder),
    'Retention PDF Unique',
    'pdf',
    'published',
    'study-content/retention-unique/obj-u',
    'application/pdf',
    50
  returning id
)
select id into temp t_mat_u from ins;

grant select on curriculum, t_admin, t_student, t_folder, t_mat_a, t_mat_b, t_mat_u
  to anon, authenticated;

------------------------------------------------------------------
-- Soft-delete seals purge_after = deleted_at + 7 days
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_admin),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);
select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_u))$$,
  'soft delete unique material'
);

select ok(
  (
    select purge_after = deleted_at + interval '7 days'
    from public.materials
    where id = (select id from t_mat_u)
  ),
  'purge_after equals deleted_at + 7 days'
);

------------------------------------------------------------------
-- Soft-deleted: authorize denied for admin and student
------------------------------------------------------------------
select throws_ok(
  $$select public.authorize_study_object((select id from t_mat_u))$$,
  'study_object_denied',
  'admin authorize denied for soft-deleted material'
);

select test_helpers.as_user(
  (select id from t_student),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid
);
select throws_ok(
  $$select public.authorize_study_object((select id from t_mat_u))$$,
  'study_object_denied',
  'student authorize denied for soft-deleted material'
);

select test_helpers.as_user(
  (select id from t_admin),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);
select lives_ok(
  $$select public.restore_content('material', (select id from t_mat_u))$$,
  'restore unique material'
);

select lives_ok(
  $$select public.authorize_study_object((select id from t_mat_u))$$,
  'authorize restored after recover'
);

------------------------------------------------------------------
-- 6d23h not eligible; 7d eligible via purge_after = deleted_at + 7d
------------------------------------------------------------------
select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_u))$$,
  'soft delete unique again for expiry tests'
);

update public.materials
set
  deleted_at = now() - interval '6 days 23 hours',
  purge_after = (now() - interval '6 days 23 hours') + interval '7 days'
where id = (select id from t_mat_u);

select test_helpers.as_runner();
select lives_ok(
  $$select public.purge_expired_bin_items()$$,
  'purge_expired at 6d23h runs'
);

select ok(
  exists (select 1 from public.materials where id = (select id from t_mat_u)),
  '6d23h material not purged'
);

update public.materials
set
  deleted_at = now() - interval '7 days',
  purge_after = (now() - interval '7 days') + interval '7 days'
where id = (select id from t_mat_u);

select lives_ok(
  $$select public.purge_expired_bin_items()$$,
  'purge_expired at 7d runs'
);

select ok(
  not exists (select 1 from public.materials where id = (select id from t_mat_u)),
  '7d material permanently purged'
);

select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.r2_purge_queue
    where object_key = 'study-content/retention-unique/obj-u'
      and completed_at is null
  ),
  'unique R2 key enqueued after 7d purge'
);

------------------------------------------------------------------
-- Recovered before expiry → no purge
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_admin),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);
select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_a))$$,
  'soft delete shared material A'
);

update public.materials
set
  deleted_at = now() - interval '8 days',
  purge_after = (now() - interval '8 days') + interval '7 days'
where id = (select id from t_mat_a);

select lives_ok(
  $$select public.restore_content('material', (select id from t_mat_a))$$,
  'recover before auto-purge'
);

select test_helpers.as_runner();
select lives_ok(
  $$select public.purge_expired_bin_items()$$,
  'purge_expired after recover'
);

select ok(
  exists (
    select 1 from public.materials
    where id = (select id from t_mat_a) and deleted_at is null
  ),
  'recovered material survives purge_expired'
);

------------------------------------------------------------------
-- Shared R2: purge A while B still references → no enqueue
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_admin),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);
select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_mat_a))$$,
  'soft delete A again for shared R2'
);

select lives_ok(
  $$select public.purge_content('material', (select id from t_mat_a))$$,
  'manual permanent purge of A'
);

select test_helpers.as_runner();
select ok(
  not exists (
    select 1 from public.r2_purge_queue
    where object_key = 'study-content/retention-shared/obj-a'
      and completed_at is null
  ),
  'shared R2 key not enqueued while B still references it'
);

select ok(
  exists (select 1 from public.materials where id = (select id from t_mat_b)),
  'shared sibling B still present'
);

select * from finish();
rollback;
