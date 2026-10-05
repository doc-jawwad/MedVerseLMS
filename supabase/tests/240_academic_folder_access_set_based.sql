-- Set-based accessible_folder_ids / get_academic_tree lock flags
-- must match per-folder can_access_material_folder semantics.
begin;
select plan(6);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Fanout Student') as id
  into temp t_student;
select test_helpers.make_admin('Fanout Admin') as id into temp t_admin;

-- Reuse seeded Year-1 product Block subject (unique product_key already present).
select id into temp t_subject
from public.subjects
where year_id = (select year_id from curriculum)
  and product_key = 'block-1'
limit 1;

with ins as (
  insert into public.material_folders (
    year_id, subject_id, name, library_type, entitlement, content_surface, sort_order
  )
  values (
    (select year_id from curriculum),
    (select id from t_subject),
    'Free Notes Fanout',
    'notes',
    'free',
    'academic',
    1
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
    'Paid Notes Fanout',
    'notes',
    'free',
    'academic',
    2
  )
  returning id
)
select id into temp t_paid from ins;

with ins as (
  insert into public.material_folders (
    year_id, subject_id, name, library_type, entitlement, content_surface, sort_order
  )
  values (
    (select year_id from curriculum),
    (select id from t_subject),
    'Restricted Free Fanout',
    'notes',
    'free',
    'academic',
    3
  )
  returning id
)
select id into temp t_restricted from ins;

grant select on curriculum, t_student, t_admin, t_subject, t_free, t_paid, t_restricted
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'materials_folder', (select id from t_paid), 'any_subscription'
);
select public.restrict_access(
  (select id from t_student),
  'materials_folder',
  null,
  null,
  (select id from t_restricted)
);

select test_helpers.as_user((select id from t_student));

select is(
  (
    select coalesce(array_agg(id order by id), array[]::uuid[])
    from public.accessible_folder_ids()
    where id in (
      select id from t_free
      union all select id from t_paid
      union all select id from t_restricted
    )
  ),
  (
    select coalesce(array_agg(f.id order by f.id), array[]::uuid[])
    from public.material_folders f
    where f.id in (
      select id from t_free
      union all select id from t_paid
      union all select id from t_restricted
    )
      and public.can_access_material_folder(f.id)
  ),
  '1 accessible_folder_ids matches per-folder can_access_material_folder'
);

select is(
  (
    select coalesce(array_agg(id order by id), array[]::uuid[])
    from public.accessible_folder_ids_among(array[
      (select id from t_free),
      (select id from t_paid),
      (select id from t_restricted)
    ])
  ),
  (
    select coalesce(array_agg(id order by id), array[]::uuid[])
    from public.accessible_folder_ids()
    where id in (
      select id from t_free
      union all select id from t_paid
      union all select id from t_restricted
    )
  ),
  '2 accessible_folder_ids_among matches accessible_folder_ids for the same ids'
);

select ok(
  public.can_access_material_folder((select id from t_free)),
  '3 free folder accessible without live subscription'
);

select ok(
  not public.can_access_material_folder((select id from t_paid)),
  '4 any_subscription folder not accessible without live subscription'
);

select ok(
  not public.can_access_material_folder((select id from t_restricted)),
  '5 restricted free folder is not accessible'
);

select ok(
  (
    select bool_and(
      (x->>'locked')::boolean
        = not public.can_access_material_folder((x->>'folder_id')::uuid)
    )
    from jsonb_array_elements(public.get_academic_tree('resources')->'subjects') s
    cross join lateral jsonb_array_elements(s->'categories') c
    cross join lateral jsonb_array_elements(c->'folders') x
    where (x->>'folder_id')::uuid in (
      select id from t_free
      union all select id from t_paid
      union all select id from t_restricted
    )
  ),
  '6 get_academic_tree locked flags match can_access_material_folder'
);

select * from finish();
rollback;
