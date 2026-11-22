-- search_academic_tree: surface access + One Liner naming + folder accessibility
begin;
select plan(8);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Search Free') as id
  into temp t_free;
select test_helpers.make_student((select year_id from curriculum), 'Search Paid') as id
  into temp t_paid;
select test_helpers.make_admin('Search Admin') as id into temp t_admin;
select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;
select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11'
where id = (select id from t_free);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc11'
where id = (select id from t_admin);

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

insert into public.material_folders (
  id, year_id, subject_id, name, library_type, content_surface,
  entitlement, sort_order
) values
  (
    'b2222222-2222-4222-8222-222222222201'::uuid,
    (select year_id from curriculum),
    (select id from t_block1),
    'SEARCH_FREE_OL_FOLDER',
    'one_liner',
    'academic',
    'free',
    1
  ),
  (
    'b2222222-2222-4222-8222-222222222202'::uuid,
    (select year_id from curriculum),
    (select id from t_block1),
    'SEARCH_PAID_NOTES_FOLDER',
    'notes',
    'academic',
    'free',
    2
  );

grant select on curriculum, t_free, t_paid, t_admin, t_plan, t_block1
  to anon, authenticated;

select test_helpers.as_user(
  (select id from t_admin),
  'cccccccc-cccc-cccc-cccc-cccccccccc11'::uuid
);
select public.set_resource_entitlement(
  'materials_folder',
  'b2222222-2222-4222-8222-222222222202'::uuid,
  'any_subscription'
);
select test_helpers.as_runner();

------------------------------------------------------------------
-- Free / resources
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11'::uuid
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(public.search_academic_tree('One Liner', 20, 'resources')) h
    where h->>'kind' = 'category'
      and h->>'name' = 'One Liner'
      and h->>'product_key' is not null
  ),
  '1 free search finds One Liner category with product_key'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.search_academic_tree('Pearl Points', 20, 'resources')) h
    where h->>'name' = 'Pearl Points'
  ),
  '2 free search does not use legacy Pearl Points category name'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.search_academic_tree('SEARCH_FREE_OL_FOLDER', 20, 'resources')
    ) h
    where h->>'kind' = 'folder' and h->>'name' = 'SEARCH_FREE_OL_FOLDER'
  ),
  '3 free search returns accessible free folder'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.search_academic_tree('SEARCH_PAID_NOTES_FOLDER', 20, 'resources')
    ) h
    where h->>'kind' = 'folder'
  ),
  '4 free search omits paid-inaccessible folder'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.search_academic_tree('Prof', 20, 'resources')) h
    where h->>'kind' in ('prof_session', 'day', 'prof_session_day')
  ),
  '5 free/resources search omits Prof. Session'
);

------------------------------------------------------------------
-- Paid / library
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_paid),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11'::uuid
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.search_academic_tree('SEARCH_PAID_NOTES_FOLDER', 20, 'library')
    ) h
    where h->>'kind' = 'folder' and h->>'name' = 'SEARCH_PAID_NOTES_FOLDER'
  ),
  '6 paid/library search returns class-accessible paid folder'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(public.search_academic_tree('Prof', 20, 'library')) h
    where h->>'kind' = 'prof_session'
  ),
  '7 paid/library search includes Prof. Session chrome'
);

select ok(
  position('correct_key' in public.search_academic_tree('One Liner', 20, 'library')::text) = 0
  and position('drive_url' in public.search_academic_tree('One Liner', 20, 'library')::text) = 0,
  '8 search payload has no item secrets'
);

select * from finish();
rollback;
