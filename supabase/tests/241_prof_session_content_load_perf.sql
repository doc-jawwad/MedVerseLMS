-- Issue 8: accessible_folder_ids_among stays semantically identical to
-- filtering accessible_folder_ids; get_academic_tree day objects omit unused
-- aggregate fields but still expose ordered slots.
begin;
select plan(5);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Issue8 Perf Student') as id
  into temp t_student;
select test_helpers.make_admin('Issue8 Perf Admin') as id into temp t_admin;

select id into temp t_subject
from public.subjects
where year_id = (select year_id from curriculum)
  and product_key = 'block-1'
limit 1;

-- Noise folders so among() must not depend on scanning the full set for correctness.
insert into public.material_folders (
  year_id, subject_id, name, library_type, entitlement, content_surface, sort_order
)
select
  (select year_id from curriculum),
  (select id from t_subject),
  'Issue8 Noise ' || g,
  'notes',
  'free',
  'academic',
  g
from generate_series(1, 40) as g;

with ins as (
  insert into public.material_folders (
    year_id, subject_id, name, library_type, entitlement, content_surface, sort_order
  )
  values (
    (select year_id from curriculum),
    (select id from t_subject),
    'Issue8 Free Notes',
    'notes',
    'free',
    'academic',
    100
  )
  returning id
)
select id into temp t_free from ins;

with ins as (
  insert into public.material_folders (
    year_id, subject_id, name, library_type, entitlement, content_surface, sort_order
  )
  values (
    (select year_id from curriculum),
    (select id from t_subject),
    'Issue8 Paid Notes',
    'notes',
    'free',
    'academic',
    101
  )
  returning id
)
select id into temp t_paid from ins;

-- Published PS day with fixed slots (trigger may already insert slots).
with ins as (
  insert into public.prof_session_days (
    subject_id, year_id, name, sort_order, status
  )
  values (
    (select id from t_subject),
    (select year_id from curriculum),
    'Issue8 Day',
    0,
    'published'
  )
  returning id
)
select id into temp t_day from ins;

insert into public.prof_session_day_slots (day_id, slot_key)
values
  ((select id from t_day), 'guidelines'),
  ((select id from t_day), 'los'),
  ((select id from t_day), 'one_liners'),
  ((select id from t_day), 'practice_mcqs'),
  ((select id from t_day), 'test_mcq')
on conflict do nothing;

grant select on curriculum, t_student, t_admin, t_subject, t_free, t_paid, t_day
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'materials_folder', (select id from t_paid), 'any_subscription'
);
select test_helpers.as_runner();

select test_helpers.as_user((select id from t_student));

select is(
  (
    select coalesce(array_agg(id order by id), array[]::uuid[])
    from public.accessible_folder_ids_among(array[
      (select id from t_free),
      (select id from t_paid)
    ])
  ),
  (
    select coalesce(array_agg(id order by id), array[]::uuid[])
    from public.accessible_folder_ids()
    where id in ((select id from t_free), (select id from t_paid))
  ),
  '1 among(subset) matches filtering accessible_folder_ids (no live sub)'
);

select ok(
  public.can_access_material_folder((select id from t_free))
  and not public.can_access_material_folder((select id from t_paid)),
  '2 free allowed / any_subscription denied without live subscription'
);

-- Live subscription so Prof. Session days appear in the tree.
select test_helpers.as_runner();
select id into temp t_plan
from public.subscription_plans
where is_complimentary = false
order by sort_order, name
limit 1;

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
values (
  (select id from t_student),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0
);

grant select on t_plan to anon, authenticated;

select test_helpers.as_user((select id from t_student));

select is(
  (
    select coalesce(array_agg(id order by id), array[]::uuid[])
    from public.accessible_folder_ids_among(array[
      (select id from t_free),
      (select id from t_paid)
    ])
  ),
  (
    select coalesce(array_agg(id order by id), array[]::uuid[])
    from public.accessible_folder_ids()
    where id in ((select id from t_free), (select id from t_paid))
  ),
  '3 among(subset) matches filtering accessible_folder_ids (with live sub)'
);

select ok(
  (
    select bool_and(
      d ? 'day_id'
      and d ? 'name'
      and d ? 'slots'
      and not (d ? 'practice_count')
      and not (d ? 'test_count')
      and not (d ? 'one_liner_count')
      and not (d ? 'has_guidelines')
      and not (d ? 'has_los')
    )
    from jsonb_array_elements(
      public.get_academic_tree('library')->'prof_session'->'subjects'
    ) s
    cross join lateral jsonb_array_elements(s->'days') d
    where (d->>'day_id')::uuid = (select id from t_day)
  ),
  '4 get_academic_tree day objects omit unused aggregate fields'
);

select is(
  (
    select array_agg(sl->>'slot_key' order by ord)
    from jsonb_array_elements(
      (
        select d->'slots'
        from jsonb_array_elements(
          public.get_academic_tree('library')->'prof_session'->'subjects'
        ) s
        cross join lateral jsonb_array_elements(s->'days') d
        where (d->>'day_id')::uuid = (select id from t_day)
        limit 1
      )
    ) with ordinality as t(sl, ord)
  ),
  array['guidelines','los','practice_mcqs','test_mcq','one_liners']::text[],
  '5 day slot chrome order preserved'
);

select * from finish();
rollback;
