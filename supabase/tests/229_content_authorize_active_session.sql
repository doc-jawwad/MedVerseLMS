-- M2: content authorize/open require is_active_session().
begin;
select plan(12);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Sess Student') as id
  into temp t_student;
select test_helpers.make_admin('Sess Main') as id into temp t_admin;
select test_helpers.make_limited_admin('Sess Mats', array['manage_materials']) as id
  into temp t_mats;

select gen_random_uuid() as id into temp t_sess_stu;
select gen_random_uuid() as id into temp t_sess_admin;
select gen_random_uuid() as id into temp t_sess_mats;
select gen_random_uuid() as id into temp t_sess_stale;

grant select on curriculum, t_student, t_admin, t_mats,
  t_sess_stu, t_sess_admin, t_sess_mats, t_sess_stale
  to anon, authenticated;

update public.profiles
set active_session_id = (select id from t_sess_stu)
where id = (select id from t_student);
update public.profiles
set active_session_id = (select id from t_sess_admin)
where id = (select id from t_admin);
update public.profiles
set active_session_id = (select id from t_sess_mats)
where id = (select id from t_mats);

select test_helpers.as_user((select id from t_admin), (select id from t_sess_admin));
select public.set_admin_year_assignments(
  (select id from t_mats),
  array[(select year_id from curriculum)]
);
select test_helpers.as_runner();

with ins as (
  insert into public.material_folders (
    name, year_id, library_type, entitlement
  ) values (
    'Sess Free Notes',
    (select year_id from curriculum),
    'notes',
    'free'
  )
  returning id
)
select id into temp t_folder from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size
  ) values (
    (select id from t_folder),
    'Sess PDF',
    'pdf',
    'published',
    'study-content/sess/active.pdf',
    'application/pdf',
    100
  )
  returning id
)
select id into temp t_mat from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, drive_url
  ) values (
    (select id from t_folder),
    'Sess Drive',
    'drive',
    'published',
    'https://drive.google.com/file/d/sess-drive'
  )
  returning id
)
select id into temp t_drive from ins;

grant select on t_folder, t_mat, t_drive to anon, authenticated;

------------------------------------------------------------------
-- Active student session → authorize / open OK
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), (select id from t_sess_stu));
select is(
  public.authorize_study_object((select id from t_mat)),
  'study-content/sess/active.pdf',
  'M2 active student authorizes PDF'
);
select is(
  public.open_material((select id from t_drive)),
  'https://drive.google.com/file/d/sess-drive',
  'M2 active student opens Drive material'
);
select is(
  (public.open_study_item((select id from t_mat)) ->> 'has_pdf'),
  'true',
  'M2 active student opens study item metadata'
);

------------------------------------------------------------------
-- Invalidated / kicked session → denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), (select id from t_sess_stale));
select throws_ok(
  $$select public.authorize_study_object((select id from t_mat))$$,
  'study_object_denied',
  'M2 invalidated student session cannot authorize PDF'
);
select throws_ok(
  $$select public.open_material((select id from t_drive))$$,
  'material_access_denied',
  'M2 invalidated student session cannot open Drive'
);
select throws_ok(
  $$select public.open_study_item((select id from t_mat))$$,
  'material_access_denied',
  'M2 invalidated student session cannot open study item'
);

------------------------------------------------------------------
-- Entitlement still enforced with active session
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin), (select id from t_sess_admin));
select public.set_resource_entitlement(
  'materials_folder',
  (select id from t_folder),
  'any_subscription'
);
select test_helpers.as_user((select id from t_student), (select id from t_sess_stu));
select throws_ok(
  $$select public.authorize_study_object((select id from t_mat))$$,
  'study_object_denied',
  'M2 active session still requires entitlement'
);

-- Restore free entitlement for admin checks
select test_helpers.as_user((select id from t_admin), (select id from t_sess_admin));
select public.set_resource_entitlement(
  'materials_folder',
  (select id from t_folder),
  'free'
);

------------------------------------------------------------------
-- Admin active session OK; kicked admin denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_mats), (select id from t_sess_mats));
select is(
  public.authorize_study_object((select id from t_mat)),
  'study-content/sess/active.pdf',
  'M2 active materials admin authorizes PDF'
);

select test_helpers.as_user((select id from t_mats), (select id from t_sess_stale));
select throws_ok(
  $$select public.authorize_study_object((select id from t_mat))$$,
  'study_object_denied',
  'M2 invalidated materials admin cannot authorize PDF'
);

select test_helpers.as_user((select id from t_admin), (select id from t_sess_admin));
select is(
  public.authorize_study_object((select id from t_mat)),
  'study-content/sess/active.pdf',
  'M2 active main admin authorizes PDF'
);

select test_helpers.as_user((select id from t_admin), (select id from t_sess_stale));
select throws_ok(
  $$select public.authorize_study_object((select id from t_mat))$$,
  'study_object_denied',
  'M2 invalidated main admin cannot authorize PDF'
);

------------------------------------------------------------------
-- Helper still present on authorize body
------------------------------------------------------------------
select test_helpers.as_runner();
select ok(
  pg_get_functiondef('public.authorize_study_object(uuid)'::regprocedure)
    like '%is_active_session()%',
  'M2 authorize_study_object references is_active_session'
);

select * from finish();
rollback;
