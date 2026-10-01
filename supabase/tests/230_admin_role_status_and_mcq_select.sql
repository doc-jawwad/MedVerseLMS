-- M1: is_admin / has_permission respect account_status.
-- M5: list_admin_year_assignments scope (helper used by loadAdminYearsForCaller).
-- M8: mcq_bank folder/subfolder admin SELECT year scope.
begin;
select plan(19);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_admin('RoleStatus Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'RoleStatus Edit Y1',
  array['edit_questions']
) as id into temp t_edit_y1;
select test_helpers.make_limited_admin(
  'RoleStatus Edit Y2',
  array['edit_questions']
) as id into temp t_edit_y2;
select test_helpers.make_limited_admin(
  'RoleStatus Blocked',
  array['edit_questions', 'manage_materials']
) as id into temp t_blocked;
select test_helpers.make_student((select year_id from curriculum), 'RoleStatus Student') as id
  into temp t_student;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

insert into public.subjects (year_id, name, product_key)
select (select id from t_year2), 'RoleStatus Y2 Block', 'block-1'
where not exists (
  select 1 from public.subjects
  where year_id = (select id from t_year2) and product_key = 'block-1'
);

select id into temp t_block_y2
  from public.subjects
  where year_id = (select id from t_year2) and product_key = 'block-1'
  limit 1;

grant select on curriculum, t_year2, t_main, t_edit_y1, t_edit_y2, t_blocked,
  t_student, t_block1, t_block_y2
  to anon, authenticated;

-- Assign years
select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_edit_y1),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_edit_y2),
  array[(select id from t_year2)]
);
select public.set_admin_year_assignments(
  (select id from t_blocked),
  array[(select year_id from curriculum)]
);

-- Seed MCQ folder + subfolder in year 1 and year 2
create temporary table t_folder_y1 (id uuid);
create temporary table t_folder_y2 (id uuid);
create temporary table t_sf_y1 (id uuid);
create temporary table t_sf_y2 (id uuid);
grant select, insert on t_folder_y1, t_folder_y2, t_sf_y1, t_sf_y2
  to anon, authenticated;

select test_helpers.as_user((select id from t_main));
insert into t_folder_y1 (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'RoleStatus Y1');
insert into t_folder_y2 (id)
select public.admin_create_mcq_bank_folder((select id from t_block_y2), 'RoleStatus Y2');
insert into t_sf_y1 (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder_y1), 'SF Y1');
insert into t_sf_y2 (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder_y2), 'SF Y2');

------------------------------------------------------------------
-- M1: active admin allowed
------------------------------------------------------------------
select test_helpers.as_user((select id from t_edit_y1));
select ok(public.is_admin(), 'M1: active limited admin is_admin');
select ok(
  public.has_permission('edit_questions'),
  'M1: active limited admin has_permission(edit_questions)'
);

select test_helpers.as_user((select id from t_main));
select ok(public.is_admin(), 'M1: active Main Admin is_admin');
select ok(
  public.has_permission('manage_admins'),
  'M1: active Main Admin has_permission (short-circuit)'
);

------------------------------------------------------------------
-- M1: blocked statuses denied for admin authority
------------------------------------------------------------------
select test_helpers.as_runner();
update public.profiles
set account_status = 'restricted'
where id = (select id from t_blocked);

select test_helpers.as_user((select id from t_blocked));
select ok(not public.is_admin(), 'M1: restricted admin is_admin=false');
select ok(
  not public.has_permission('edit_questions'),
  'M1: restricted admin has_permission=false'
);

select test_helpers.as_runner();
update public.profiles
set account_status = 'suspended'
where id = (select id from t_blocked);
select test_helpers.as_user((select id from t_blocked));
select ok(not public.is_admin(), 'M1: suspended admin is_admin=false');

select test_helpers.as_runner();
update public.profiles
set account_status = 'deactivated'
where id = (select id from t_blocked);
select test_helpers.as_user((select id from t_blocked));
select ok(not public.is_admin(), 'M1: deactivated admin is_admin=false');

select test_helpers.as_runner();
update public.profiles
set account_status = 'revoked'
where id = (select id from t_blocked);
select test_helpers.as_user((select id from t_blocked));
select ok(not public.is_admin(), 'M1: revoked admin is_admin=false');
select ok(
  not public.has_permission('manage_materials'),
  'M1: revoked admin has_permission=false'
);

------------------------------------------------------------------
-- M1: student unaffected (still not admin)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(not public.is_admin(), 'M1: student is_admin=false');
select ok(
  not public.has_permission('edit_questions'),
  'M1: student has_permission=false'
);

------------------------------------------------------------------
-- M5: assigned years via list_admin_year_assignments
------------------------------------------------------------------
select test_helpers.as_user((select id from t_edit_y1));
select is(
  (select count(*)::int from public.list_admin_year_assignments()),
  1,
  'M5: assigned admin lists exactly one year'
);
select is(
  (select year_id from public.list_admin_year_assignments() limit 1),
  (select year_id from curriculum),
  'M5: assigned admin lists own year only'
);

select test_helpers.as_user((select id from t_main));
select ok(
  (select count(*)::int from public.years) >= 2,
  'M5: Main Admin can see full years table (unrestricted scope)'
);

------------------------------------------------------------------
-- M8: own-year folder/subfolder visible; cross-year denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_edit_y1));
select ok(
  exists (
    select 1 from public.mcq_bank_folders
    where id = (select id from t_folder_y1)
  ),
  'M8: assigned Y1 admin sees own-year folder'
);
select ok(
  exists (
    select 1 from public.mcq_bank_subfolders
    where id = (select id from t_sf_y1)
  ),
  'M8: assigned Y1 admin sees own-year subfolder'
);
select ok(
  not exists (
    select 1 from public.mcq_bank_folders
    where id = (select id from t_folder_y2)
  ),
  'M8: assigned Y1 admin denied cross-year folder'
);
select ok(
  not exists (
    select 1 from public.mcq_bank_subfolders
    where id = (select id from t_sf_y2)
  ),
  'M8: assigned Y1 admin denied cross-year subfolder'
);

select * from finish();
rollback;
