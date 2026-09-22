-- Data Spine: prof session days, block product_key mapping, content bin.
begin;
select plan(40);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Bin Free') as id
  into temp t_free;
select test_helpers.make_student((select year_id from curriculum), 'Bin Paid') as id
  into temp t_paid;
select test_helpers.make_admin('Bin Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'Bin Limited',
  array['manage_materials', 'edit_questions']
) as id into temp t_limited;
select id into temp t_year1 from public.years where year_number = 1;
select id into temp t_year2 from public.years where year_number = 2;
select id into temp t_year5 from public.years where year_number = 5;
select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
where id = (select id from t_free);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
where id = (select id from t_main);
update public.profiles
set active_session_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'
where id = (select id from t_limited);

-- Paid subscription for t_paid on year 1
insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_paid),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

grant select on curriculum, t_free, t_paid, t_main, t_limited,
  t_year1, t_year2, t_year5, t_plan
  to anon, authenticated;

-- Limited admin assigned only year 1
select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_limited),
  array[(select id from t_year1)]
);
select test_helpers.as_runner();

------------------------------------------------------------------
-- Block mapping: exact product keys
------------------------------------------------------------------
select is(
  (select count(*)::int from public.subjects
   where year_id = (select id from t_year1) and product_key in ('block-1','block-2','block-3')),
  3,
  'year 1 has Block 1–3 product subjects'
);

select is(
  (select count(*)::int from public.subjects
   where year_id = (select id from t_year2) and product_key in ('block-4','block-5','block-6')),
  3,
  'year 2 has Block 4–6 product subjects'
);

select is(
  (select count(*)::int from public.subjects
   where year_id = (select id from t_year5)
     and product_key in ('medicine','surgery','gynecology','pediatrics')),
  4,
  'final year has four clinical product subjects'
);

select is(
  (select name from public.years where year_number = 5),
  'Final Year MBBS',
  'year 5 display name is Final Year MBBS'
);

select ok(
  exists (
    select 1 from public.subjects
    where year_id = (select id from t_year1)
      and name = 'Anatomy'
      and product_key is null
  ),
  'departmental Anatomy remains without product_key'
);

------------------------------------------------------------------
-- Prof Session: admin create / student access (subject-scoped)
------------------------------------------------------------------
select id into temp t_block1
  from public.subjects
  where year_id = (select id from t_year1) and product_key = 'block-1'
  limit 1;
select id into temp t_block4
  from public.subjects
  where year_id = (select id from t_year2) and product_key = 'block-4'
  limit 1;
grant select on t_block1, t_block4 to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.admin_create_prof_session_day(
    (select id from t_block1), 'Day 1', 1
  )$$,
  'main admin creates prof session day under Block 1'
);

select id into temp t_day from public.prof_session_days
where subject_id = (select id from t_block1) and name = 'Day 1' and deleted_at is null
limit 1;

select is(
  (select count(*)::int from public.prof_session_day_slots
   where day_id = (select id from t_day)),
  5,
  'create day scaffolds five fixed slots'
);

select ok(
  not exists (
    select 1 from public.prof_session_day_slots
    where day_id = (select id from t_day) and slot_key = 'syllabus'
  ),
  'day slots no longer include syllabus'
);

select ok(
  exists (
    select 1 from public.prof_session_day_slots
    where day_id = (select id from t_day) and slot_key = 'los'
  ),
  'day slots include los'
);

select lives_ok(
  $$select public.admin_update_prof_session_day(
    (select id from t_day), 'Day 1 Published', null, 'published'
  )$$,
  'admin publishes prof session day'
);

-- Free student: tree has locked empty prof_session subjects
select test_helpers.as_user((select id from t_free));
select is(
  (select (public.get_academic_tree('resources')->'prof_session'->>'locked')::boolean),
  true,
  'free student prof_session locked'
);
select is(
  (select jsonb_array_length(public.get_academic_tree('resources')->'prof_session'->'subjects')),
  0,
  'free student does not see prof session subjects'
);

-- Paid student: sees published day nested under subject
select test_helpers.as_user((select id from t_paid));
select ok(
  (select public.get_academic_tree('library')->'prof_session'->>'locked')::boolean = false,
  'paid student prof_session unlocked'
);
select ok(
  (
    select coalesce(sum(jsonb_array_length(s->'days')), 0)::int
    from jsonb_array_elements(
      public.get_academic_tree('library')->'prof_session'->'subjects'
    ) s
  ) >= 1,
  'paid student sees published days under subjects'
);

-- Tree returns product blocks only for year 1
select is(
  (select count(*)::int from jsonb_array_elements(
    public.get_academic_tree('library')->'subjects'
  ) s where s->>'product_key' is not null),
  3,
  'academic tree returns three year-1 product blocks'
);

select ok(
  (select bool_and(s->>'product_key' in ('block-1','block-2','block-3'))
   from jsonb_array_elements(public.get_academic_tree('library')->'subjects') s),
  'tree product_keys are block-1..3 for year 1 enrollment'
);

------------------------------------------------------------------
-- Limited admin year scope
------------------------------------------------------------------
select test_helpers.as_user((select id from t_limited));
select lives_ok(
  $$select public.admin_create_prof_session_day(
    (select id from t_block1), 'Day Limited', 2
  )$$,
  'limited admin can create day in assigned year subject'
);

select throws_ok(
  $$select public.admin_create_prof_session_day(
    (select id from t_block4), 'Day Denied', 1
  )$$,
  'year_scope_denied',
  'limited admin cannot create day outside assigned year'
);

------------------------------------------------------------------
-- Soft delete / bin / restore / purge
------------------------------------------------------------------
select test_helpers.as_runner();
with ins as (
  insert into public.material_folders (year_id, subject_id, name, library_type, entitlement)
  select
    (select year_id from curriculum),
    (select id from public.subjects where year_id = (select year_id from curriculum) and product_key = 'block-1' limit 1),
    'Bin Folder',
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
    'Bin PDF',
    'pdf',
    'published',
    'study-content/bin-test/' || gen_random_uuid()::text,
    'application/pdf',
    100
  returning id
)
select id into temp t_material from ins;

grant select on t_day, t_folder, t_material, t_block1, t_block4 to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_material))$$,
  'soft delete material'
);

select ok(
  (select deleted_at is not null from public.materials where id = (select id from t_material)),
  'material has deleted_at after soft delete'
);

select ok(
  (select purge_after > now() + interval '6 days'
   from public.materials where id = (select id from t_material)),
  'purge_after is ~7 days out'
);

-- Hidden from student catalog helpers
select test_helpers.as_user((select id from t_paid));
select ok(
  not public.can_view_material_folder((select id from t_folder))
  or not exists (
    select 1 from public.materials m
    where m.id = (select id from t_material)
      and public.can_view_material_folder(m.folder_id)
      and m.deleted_at is null
  ),
  'soft-deleted material not in active catalog view'
);

-- Student cannot list bin
select throws_ok(
  $$select public.list_content_bin(null)$$,
  'admin_only',
  'student cannot list content bin'
);

select test_helpers.as_user((select id from t_main));
select ok(
  (select count(*)::int >= 1 from public.list_content_bin((select year_id from curriculum))),
  'admin lists soft-deleted items in bin'
);

select lives_ok(
  $$select public.restore_content('material', (select id from t_material))$$,
  'admin restores material from bin'
);

select ok(
  (select deleted_at is null from public.materials where id = (select id from t_material)),
  'restored material has cleared deleted_at'
);

-- Soft delete again and purge early
select lives_ok(
  $$select public.soft_delete_content('material', (select id from t_material))$$,
  'soft delete material again'
);
select lives_ok(
  $$select public.purge_content('material', (select id from t_material))$$,
  'admin can permanently purge before 7 days'
);

select ok(
  not exists (select 1 from public.materials where id = (select id from t_material)),
  'purged material row gone'
);

select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.r2_purge_queue
    where object_key like 'study-content/bin-test/%'
      and completed_at is null
  ),
  'R2 key enqueued on purge'
);

------------------------------------------------------------------
-- Soft delete folder + expired purge cron path
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.soft_delete_content('material_folder', (select id from t_folder))$$,
  'soft delete folder'
);

-- Force expiry and run purge job
select test_helpers.as_runner();
update public.material_folders
set purge_after = now() - interval '1 minute'
where id = (select id from t_folder);

select lives_ok(
  $$select public.purge_expired_bin_items()$$,
  'purge_expired_bin_items runs'
);

select ok(
  not exists (select 1 from public.material_folders where id = (select id from t_folder)),
  'expired folder permanently purged by job'
);

------------------------------------------------------------------
-- Prof session soft delete + free lock still holds
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.admin_soft_delete_prof_session_day((select id from t_day))$$,
  'admin soft deletes prof session day'
);

select test_helpers.as_user((select id from t_paid));
select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.get_academic_tree('library')->'prof_session'->'subjects'
    ) s,
    jsonb_array_elements(s->'days') d
    where d->>'day_id' = (select id::text from t_day)
  ),
  'soft-deleted day hidden from paid student tree'
);

select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.admin_restore_prof_session_day((select id from t_day))$$,
  'admin restores soft-deleted day'
);

------------------------------------------------------------------
-- Search excludes soft-deleted / free does not search days
------------------------------------------------------------------
select test_helpers.as_user((select id from t_free));
select ok(
  not exists (
    select 1 from jsonb_array_elements(public.search_academic_tree('Day', 20)) h
    where h->>'kind' in ('day', 'prof_session_day')
  ),
  'free student search does not return prof session days'
);

select test_helpers.as_user((select id from t_paid));
select ok(
  exists (
    select 1 from jsonb_array_elements(public.search_academic_tree('Block 1', 20)) h
    where h->>'kind' = 'block' or h->>'name' ilike '%Block 1%'
  ),
  'paid search finds Block 1'
);

------------------------------------------------------------------
-- claim/complete R2 purge batch
------------------------------------------------------------------
select test_helpers.as_runner();
select ok(
  (select count(*)::int from public.claim_r2_purge_batch(10)) >= 1,
  'claim_r2_purge_batch returns pending keys'
);

select lives_ok(
  $$select public.complete_r2_purge(
    (select id from public.r2_purge_queue where completed_at is null limit 1),
    null
  )$$,
  'complete_r2_purge marks success'
);

select * from finish();
rollback;
