-- Issue #11 / Batch 2: MCQ Bank PDFs follow subject-level authorization (D1a).
-- Includes CCS universal-folder entitlement regression (NULL year_id).
-- Synthetic fixtures only; transaction-scoped.
begin;
select plan(53);

select test_helpers.as_runner();
select * into temp c1 from test_helpers.make_curriculum();   -- paid subject
select * into temp c2 from test_helpers.make_curriculum();   -- free subject
select id as y1 into temp t_y1 from public.years where year_number = 1;
select id as y3 into temp t_y3 from public.years where year_number = 3;

-- helpers (rolled back with the transaction)
create or replace function test_helpers.try_authorize(p_material uuid)
returns text language plpgsql as $$
begin
  return public.authorize_study_object(p_material);
exception when others then
  return 'DENIED:' || sqlerrm;
end;
$$;
create or replace function test_helpers.try_set_ent(p_kind text, p_id uuid, p_ent text)
returns text language plpgsql as $$
begin
  perform public.set_resource_entitlement(p_kind, p_id, p_ent, null);
  return 'OK';
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function test_helpers.try_authorize(uuid), test_helpers.try_set_ent(text, uuid, text)
  to anon, authenticated;

-- Subjects: c1 paid, c2 free. (entitlement changes are guarded by a GUC)
select set_config('medverse.set_resource_entitlement', '1', true);
update public.subjects set entitlement = 'any_subscription'
  where id = (select subject_id from c1);
update public.subjects set entitlement = 'free'
  where id = (select subject_id from c2);
select set_config('medverse.set_resource_entitlement', '', true);

-- Folders. MCQ shadow folders are ALWAYS entitlement 'free' (as in prod).
insert into public.material_folders
  (id, year_id, subject_id, name, library_type, content_surface, entitlement)
values
  ('c1000000-0000-4000-8000-000000000001', (select y1 from t_y1), (select subject_id from c1),
   'MCQGATE_PAID_SHADOW', 'mcq_bank', 'academic', 'free'),
  ('c1000000-0000-4000-8000-000000000002', (select y1 from t_y1), (select subject_id from c2),
   'MCQGATE_FREE_SHADOW', 'mcq_bank', 'academic', 'free'),
  ('c1000000-0000-4000-8000-000000000003', (select y1 from t_y1), (select subject_id from c1),
   'MCQGATE_NOTES_FREE', 'notes', 'academic', 'free'),
  ('c1000000-0000-4000-8000-000000000004', (select y1 from t_y1), (select subject_id from c1),
   'MCQGATE_NOTES_PAID', 'notes', 'academic', 'free');
select set_config('medverse.set_resource_entitlement', '1', true);
update public.material_folders set entitlement = 'any_subscription'
  where id = 'c1000000-0000-4000-8000-000000000004';
select set_config('medverse.set_resource_entitlement', '', true);

insert into public.materials
  (id, folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size)
select m.mid::uuid, m.fid::uuid, m.title, 'pdf', 'published', 'study-content/gate/' || m.title || '.pdf', 'application/pdf', 100
from (values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'paid-shadow'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'free-shadow'),
  ('c2000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'notes-free'),
  ('c2000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000004', 'notes-paid')
) as m(mid, fid, title);

-- Students
select test_helpers.make_student((select y1 from t_y1), 'Gate Free') as id into temp s_free;
select test_helpers.make_student((select y1 from t_y1), 'Gate Sub') as id into temp s_sub;
select test_helpers.make_student((select y1 from t_y1), 'Gate RestrSubj') as id into temp s_rp;
select test_helpers.make_student((select y1 from t_y1), 'Gate RestrFolder') as id into temp s_rf;
select test_helpers.make_student((select y1 from t_y1), 'Gate Grant') as id into temp s_grant;
select test_helpers.make_student((select y1 from t_y1), 'Gate GrantRP') as id into temp s_grant_rp;
select test_helpers.make_student((select y1 from t_y1), 'Gate GrantRF') as id into temp s_grant_rf;
select test_helpers.make_student((select y1 from t_y1), 'Gate NoEnroll') as id into temp s_noenr;
select test_helpers.make_student((select y3 from t_y3), 'Gate WrongYear') as id into temp s_wy;
select test_helpers.make_student((select y1 from t_y1), 'Gate Susp') as id into temp s_susp;
delete from public.enrollments where student_id = (select id from s_noenr);
update public.profiles set account_status = 'revoked' where id = (select id from s_susp);

select id into temp t_plan from public.subscription_plans
  where is_complimentary = false order by sort_order, name limit 1;
insert into public.subscriptions (student_id, plan_id, year_id, status, starts_at, ends_at, grace_days)
select (select id from s_sub), (select id from t_plan), (select y1 from t_y1),
  'active', now() - interval '1 day', now() + interval '30 days', 0;

-- Explicit synthetic grants / restrictions (inserted by the runner)
insert into public.access_grants (student_id, grant_type, folder_id)
select s, 'materials_folder', 'c1000000-0000-4000-8000-000000000001'::uuid
from (select id as s from s_grant union all select id from s_grant_rp union all select id from s_grant_rf) x;
insert into public.access_restrictions (student_id, resource_kind, subject_id)
select id, 'practice_subject', (select subject_id from c2) from s_rp;
insert into public.access_restrictions (student_id, resource_kind, subject_id)
select id, 'practice_subject', (select subject_id from c1) from s_grant_rp;
insert into public.access_restrictions (student_id, resource_kind, folder_id)
select id, 'materials_folder', 'c1000000-0000-4000-8000-000000000002'::uuid from s_rf;
insert into public.access_restrictions (student_id, resource_kind, folder_id)
select id, 'materials_folder', 'c1000000-0000-4000-8000-000000000001'::uuid from s_grant_rf;

-- Admins
select test_helpers.make_admin('Gate Main') as id into temp a_main;
select test_helpers.make_limited_admin('Gate Mat', array['manage_materials']) as id into temp a_mat;
select test_helpers.make_student((select y1 from t_y1), 'Gate Stud2') as id into temp s_other;
grant select on c1, c2, t_y1, t_y3, s_free, s_sub, s_rp, s_rf, s_grant, s_grant_rp, s_grant_rf,
  s_noenr, s_wy, s_susp, a_main, a_mat, s_other to anon, authenticated;
select test_helpers.as_user((select id from a_main));
select public.set_admin_year_assignments((select id from a_mat), array[(select y1 from t_y1)]);
select test_helpers.as_runner();

-- A year-3 notes folder + pearl for cross-class admin tests
insert into public.material_folders (id, year_id, name, library_type, content_surface, entitlement)
values ('c1000000-0000-4000-8000-000000000009', (select y3 from t_y3), 'MCQGATE_Y3_NOTES', 'notes', 'academic', 'free');

-- Universal Career Counseling Series folder (year_id NULL by design)
insert into public.material_folders
  (id, year_id, subject_id, name, library_type, content_surface, entitlement, parent_id)
values
  ('c1000000-0000-4000-8000-00000000000a', null, null, 'MCQGATE_CCS_UNIVERSAL',
   'career_counseling_series', 'academic', 'free', null);

-- Year-scoped pearl for class-isolation negative test (subject must share pearl year)
insert into public.subjects (year_id, name)
values ((select y3 from t_y3), 'MCQGATE Y3 Pearl Subj');
insert into public.pearl_points
  (id, year_id, subject_id, prompt, answer, explanation, entitlement, status)
values
  ('c3000000-0000-4000-8000-000000000001', (select y3 from t_y3),
   (select id from public.subjects where year_id = (select y3 from t_y3) and name = 'MCQGATE Y3 Pearl Subj'),
   'MCQGATE_Y3_PEARL', 'answer', '', 'free', 'published');


-- ===== 1-8: eligible enrolled non-subscriber ===============================
select test_helpers.as_user((select id from s_free));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000001'), 'DENIED:%',
  '1 free student cannot open PAID-subject MCQ PDF (shadow folder is free)');
select is(public.can_access_material_folder('c1000000-0000-4000-8000-000000000001'), false,
  '2 scalar: paid-subject shadow folder not accessible');
select is(
  (select array_agg(x order by x) from public.accessible_folder_ids_among(array[
    'c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000004']::uuid[]) x),
  array['c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000003']::uuid[],
  '3 among: only free-subject shadow + free notes folder');
select is(
  (select count(*)::int from public.accessible_folder_ids() x
    where x in ('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004')),
  0, '4 accessible_folder_ids excludes paid shadow and paid notes');
select is(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000002'),
  'study-content/gate/free-shadow.pdf', '5 free-subject MCQ PDF opens');
select is(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000003'),
  'study-content/gate/notes-free.pdf', '6 ordinary Free notes folder (paid subject) still opens');
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000004'), 'DENIED:%',
  '7 paid notes folder still denied');
select is(
  (select count(*)::int from public.accessible_folder_ids() x),
  (select count(*)::int from public.material_folders f
    where public.can_access_material_folder(f.id) and f.deleted_at is null
      and f.id in (select x from public.accessible_folder_ids() x)),
  '8 set-based vs scalar agree for this student');

-- ===== 9-11: search surface ================================================
select is(
  position('MCQGATE_PAID_SHADOW' in public.search_academic_tree('MCQGATE_PAID', 20, 'resources')::text),
  0, '9 search does not surface paid-subject shadow folder');
select is(
  position('MCQGATE_NOTES_FREE' in public.search_academic_tree('MCQGATE_NOTES', 20, 'resources')::text) > 0,
  true, '10 search surfaces ordinary free notes folder');
select is(
  position('MCQGATE_NOTES_PAID' in public.search_academic_tree('MCQGATE_NOTES', 20, 'resources')::text),
  0, '11 search omits paid notes folder');

-- ===== 12-13: subscriber ===================================================
select test_helpers.as_user((select id from s_sub));
select is(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000001'),
  'study-content/gate/paid-shadow.pdf', '12 subscriber opens paid-subject MCQ PDF');
select is(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000004'),
  'study-content/gate/notes-paid.pdf', '13 subscriber opens paid notes');

-- ===== 14-17: restrictions precedence ======================================
select test_helpers.as_user((select id from s_rp));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000002'), 'DENIED:%',
  '14 subject-restricted student denied free-subject MCQ PDF');
select is(public.can_access_material_folder('c1000000-0000-4000-8000-000000000002'), false,
  '15 scalar denies subject-restricted student');
select is((select count(*)::int from public.accessible_folder_ids_among(
  array['c1000000-0000-4000-8000-000000000002']::uuid[])), 0,
  '16 among excludes subject-restricted student');
select test_helpers.as_user((select id from s_rf));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000002'), 'DENIED:%',
  '17 folder-restricted student denied that MCQ folder');
select is(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000003'),
  'study-content/gate/notes-free.pdf', '18 folder restriction does not affect other folders');

-- ===== 19-24: explicit grants ==============================================
select test_helpers.as_user((select id from s_grant));
select is(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000001'),
  'study-content/gate/paid-shadow.pdf', '19 explicit folder grant still opens paid-subject MCQ PDF');
select is((select count(*)::int from public.accessible_folder_ids_among(
  array['c1000000-0000-4000-8000-000000000001']::uuid[])), 1, '20 among includes granted folder');
select test_helpers.as_user((select id from s_grant_rp));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000001'), 'DENIED:%',
  '21 subject restriction beats explicit folder grant');
select is(public.can_access_material_folder('c1000000-0000-4000-8000-000000000001'), false,
  '22 scalar: subject restriction beats grant');
select is((select count(*)::int from public.accessible_folder_ids()
  where accessible_folder_ids = 'c1000000-0000-4000-8000-000000000001'), 0,
  '23 set-based: subject restriction beats grant');
select test_helpers.as_user((select id from s_grant_rf));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000001'), 'DENIED:%',
  '24 folder restriction beats explicit folder grant');

-- ===== 25-30: ineligible students =========================================
select test_helpers.as_user((select id from s_noenr));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000002'), 'DENIED:%',
  '25 no enrollment: free MCQ PDF denied');
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000003'), 'DENIED:%',
  '26 no enrollment: free notes denied');
select test_helpers.as_user((select id from s_wy));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000002'), 'DENIED:%',
  '27 wrong year: free MCQ PDF denied');
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000003'), 'DENIED:%',
  '28 wrong year: free notes denied');
select test_helpers.as_user((select id from s_susp));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000002'), 'DENIED:%',
  '29 revoked account: free MCQ PDF denied');
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000003'), 'DENIED:%',
  '30 revoked account: free notes denied');

-- ===== 31-40: set_resource_entitlement ====================================
select test_helpers.as_user((select id from a_main));
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-000000000001', 'free'),
  'mcq_bank_access_is_subject_level', '31 main admin cannot set a folder-level MCQ entitlement');
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-000000000004', 'free'),
  'OK', '32 main admin can set ordinary folder Free');
select test_helpers.as_user((select id from s_other));
select is((select count(*)::int from public.accessible_folder_ids()
  where accessible_folder_ids = 'c1000000-0000-4000-8000-000000000004'), 1,
  '33 ordinary paid folder set Free opens for eligible student');
select test_helpers.as_user((select id from a_main));
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-000000000004', 'any_subscription'),
  'OK', '34 round trip back to Paid');
select test_helpers.as_user((select id from a_mat));
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-000000000003', 'free'),
  'OK', '35 manage_materials admin can change own-class folder');
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-000000000009', 'any_subscription'),
  'permission_denied', '36 manage_materials admin denied on another class folder');
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-000000000001', 'free'),
  'mcq_bank_access_is_subject_level', '37 manage_materials admin cannot set MCQ folder entitlement');
select test_helpers.as_user((select id from s_free));
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-000000000003', 'free'),
  'permission_denied', '38 student cannot change entitlement');
select test_helpers.as_anon();
select alike(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-000000000003', 'free'),
  '%permission denied%', '39 anon cannot execute set_resource_entitlement');

-- ===== 40-42: subject switch drives MCQ access =============================
select test_helpers.as_user((select id from a_main));
select is(test_helpers.try_set_ent('practice_subject', (select subject_id from c1), 'free'),
  'OK', '40 main admin makes paid subject Free');
select test_helpers.as_user((select id from s_free));
select is(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000001'),
  'study-content/gate/paid-shadow.pdf', '41 subject Free unlocks its MCQ PDF');
select test_helpers.as_user((select id from a_main));
select is(test_helpers.try_set_ent('practice_subject', (select subject_id from c1), 'any_subscription'),
  'OK', '42 subject back to Paid');
select test_helpers.as_user((select id from s_free));
select alike(test_helpers.try_authorize('c2000000-0000-4000-8000-000000000001'), 'DENIED:%',
  '43 subject Paid re-locks MCQ PDF');

-- ===== 44-50: CCS universal + year/pearl negatives + unknown IDs ==========
select test_helpers.as_user((select id from a_mat));
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-00000000000a', 'any_subscription'),
  'OK', '44 Y1-only manage_materials admin can set universal CCS entitlement');
select is(
  (select entitlement from public.material_folders
    where id = 'c1000000-0000-4000-8000-00000000000a'),
  'any_subscription', '45 CCS entitlement persisted after NULL-year update');
select test_helpers.as_user((select id from a_main));
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-00000000000a', 'free'),
  'OK', '46 main admin can round-trip CCS entitlement back to Free');
select test_helpers.as_user((select id from a_mat));
select is(test_helpers.try_set_ent('pearl_point', 'c3000000-0000-4000-8000-000000000001', 'any_subscription'),
  'permission_denied', '47 manage_materials admin denied on another class pearl');
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-0000000000ff', 'free'),
  'resource not found', '48 unknown materials_folder id denied');
select is(test_helpers.try_set_ent('pearl_point', 'c3000000-0000-4000-8000-0000000000ff', 'free'),
  'resource not found', '49 unknown pearl_point id denied');
select test_helpers.as_user((select id from s_free));
select is(test_helpers.try_set_ent('materials_folder', 'c1000000-0000-4000-8000-00000000000a', 'free'),
  'permission_denied', '50 student cannot change CCS entitlement');

-- ===== 51-53: grants / security posture ====================================
select test_helpers.as_runner();
select is(
  (select count(*)::int from information_schema.routine_privileges
    where specific_schema = 'public' and routine_name = 'set_resource_entitlement'
      and grantee in ('anon', 'PUBLIC')),
  0, '51 set_resource_entitlement not executable by anon/public');
select is(
  has_function_privilege('authenticated', 'public.accessible_folder_ids_among(uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.accessible_folder_ids()', 'execute')
    and has_function_privilege('authenticated', 'public.can_access_material_folder(uuid)', 'execute'),
  true, '52 authenticated keeps execute on the folder access functions');
select is(
  (select count(*)::int from public.material_folders
    where library_type = 'mcq_bank' and entitlement = 'free'
      and id in ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002')),
  2, '53 shadow folder rows were not rewritten');

select * from finish();
rollback;
