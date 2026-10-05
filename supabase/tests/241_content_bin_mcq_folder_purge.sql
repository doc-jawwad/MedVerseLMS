-- Content Bin permanent delete: MCQ folder with soft-deleted subfolders,
-- protected question refs, R2 enqueue for materials, unauthorized admin.
begin;
select plan(14);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Bin MCQ Folder Purge Main') as id into temp t_admin;
select test_helpers.make_limited_admin(
  'Bin MCQ Folder Purge NoPerm',
  array['view_students']
) as id into temp t_noperm;

update public.profiles
set active_session_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'
where id = (select id from t_admin);
update public.profiles
set active_session_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'
where id = (select id from t_noperm);

select id into temp t_block
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

grant select on curriculum, t_admin, t_noperm, t_block to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_admin_year_assignments(
  (select id from t_noperm),
  array[(select year_id from curriculum)]
);

-- Disposable MCQ folder + soft-deleted subfolder + free soft-deleted question
create temporary table t_folder (id uuid);
create temporary table t_sub (id uuid);
create temporary table t_q_free (id uuid);
create temporary table t_q_prot (id uuid);
create temporary table t_test (id uuid);
create temporary table t_mat_folder (id uuid);
create temporary table t_mat (id uuid);
grant select, insert on t_folder, t_sub, t_q_free, t_q_prot, t_test, t_mat_folder, t_mat
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
insert into t_folder (id)
select public.admin_create_mcq_bank_folder((select id from t_block), 'BIN-PURGE-FOLDER');
insert into t_sub (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), 'BIN-PURGE-SUB');

insert into t_q_free (id)
select public.create_question(
  (select topic_id from curriculum),
  'BIN purge free stem ' || gen_random_uuid()::text,
  '[{"key":"A","text":"A"},{"key":"B","text":"B"},{"key":"C","text":"C"},{"key":"D","text":"D"}]'::jsonb,
  'A', '', '', 'medium', '{}', 'approved',
  (select id from t_sub)
);

insert into t_q_prot (id)
select public.create_question(
  (select topic_id from curriculum),
  'BIN purge protected stem ' || gen_random_uuid()::text,
  '[{"key":"A","text":"A"},{"key":"B","text":"B"},{"key":"C","text":"C"},{"key":"D","text":"D"}]'::jsonb,
  'A', '', '', 'medium', '{}', 'approved',
  (select id from t_sub)
);

select test_helpers.as_runner();
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, min_questions, created_by
  ) values (
    'BIN-PURGE-DRAFT',
    (select year_id from curriculum),
    'draft',
    now() + interval '1 day',
    now() + interval '2 days',
    30,
    1,
    (select id from t_admin)
  )
  returning id
)
insert into t_test (id) select id from ins;

insert into public.test_questions (test_id, question_id, question_version_id, position)
select
  (select id from t_test),
  (select id from t_q_prot),
  q.current_version_id,
  1
from public.questions q where q.id = (select id from t_q_prot);

-- Soft-delete free + protected questions and cascade-bin the folder
select test_helpers.as_user((select id from t_admin));
select public.soft_delete_content('question', (select id from t_q_free));
select public.soft_delete_content('question', (select id from t_q_prot));
-- Main Admin cascade soft-delete folder (subfolder + remaining live MCQs)
select public.admin_soft_delete_mcq_bank_folder((select id from t_folder));

------------------------------------------------------------------
-- 1–2) Protected question blocked; clear UI code preserved
------------------------------------------------------------------
select throws_ok(
  format(
    'select public.purge_content(%L, %L)',
    'question',
    (select id from t_q_prot)
  ),
  'P0001',
  'question_referenced_by_test',
  'protected question permanent delete blocked'
);

select ok(
  exists (select 1 from public.questions where id = (select id from t_q_prot)),
  'protected question row still present after blocked purge'
);

------------------------------------------------------------------
-- 3–5) Free question purge succeeds; no orphan versions/refs
------------------------------------------------------------------
select lives_ok(
  format(
    'select public.purge_content(%L, %L)',
    'question',
    (select id from t_q_free)
  ),
  'free soft-deleted question permanent delete succeeds'
);

select is(
  (select count(*)::int from public.questions where id = (select id from t_q_free)),
  0,
  'free question DB row removed'
);

select is(
  (select count(*)::int from public.question_versions
   where question_id = (select id from t_q_free)),
  0,
  'no orphan question_versions after free question purge'
);

------------------------------------------------------------------
-- 6–8) Folder with soft-deleted subfolder: permanent delete succeeds
------------------------------------------------------------------
select lives_ok(
  format(
    'select public.purge_content(%L, %L)',
    'mcq_bank_folder',
    (select id from t_folder)
  ),
  'mcq_bank_folder permanent delete succeeds with soft-deleted subfolder present'
);

select is(
  (select count(*)::int from public.mcq_bank_folders where id = (select id from t_folder)),
  0,
  'folder row removed'
);

select is(
  (select count(*)::int from public.mcq_bank_subfolders where id = (select id from t_sub)),
  0,
  'soft-deleted child subfolder removed with folder purge (no FK orphan)'
);

------------------------------------------------------------------
-- 9) Live-child refuse (fresh live folder + live sub)
------------------------------------------------------------------
select test_helpers.as_runner();
create temporary table t_live_folder (id uuid);
create temporary table t_live_sub (id uuid);
grant select, insert on t_live_folder, t_live_sub to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
insert into t_live_folder (id)
select public.admin_create_mcq_bank_folder((select id from t_block), 'BIN-PURGE-LIVE-FOLDER');
insert into t_live_sub (id)
select public.admin_create_mcq_bank_subfolder((select id from t_live_folder), 'BIN-PURGE-LIVE-SUB');

-- Force folder into bin WITHOUT cascading children (simulate inconsistent state)
select test_helpers.as_runner();
update public.mcq_bank_folders
set deleted_at = now(), purge_after = now() + interval '7 days',
    deleted_by = (select id from t_admin)
where id = (select id from t_live_folder);

select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format(
    'select public.purge_content(%L, %L)',
    'mcq_bank_folder',
    (select id from t_live_folder)
  ),
  'P0001',
  'mcq_bank_folder_not_empty',
  'folder with live subfolder refused'
);

------------------------------------------------------------------
-- 10–12) Material permanent delete + R2 enqueue + no orphan material
------------------------------------------------------------------
select test_helpers.as_runner();
with ins as (
  insert into public.material_folders (
    name, year_id, subject_id, library_type, entitlement
  )
  select
    'BIN-PURGE-MAT-FOLDER',
    (select year_id from curriculum),
    (select id from t_block),
    'notes',
    'free'
  returning id
)
insert into t_mat_folder (id) select id from ins;

with ins as (
  insert into public.materials (
    folder_id, title, kind, status, r2_object_key, r2_content_type, r2_byte_size,
    deleted_at, purge_after, deleted_by
  )
  select
    (select id from t_mat_folder),
    'BIN-PURGE unique PDF',
    'pdf',
    'published',
    'study-content/bin-purge/' || gen_random_uuid()::text,
    'application/pdf',
    64,
    now(),
    now() + interval '7 days',
    (select id from t_admin)
  returning id
)
insert into t_mat (id) select id from ins;

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.purge_content(%L, %L)',
    'material',
    (select id from t_mat)
  ),
  'soft-deleted material permanent delete succeeds'
);

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.materials where id = (select id from t_mat)),
  0,
  'material DB row removed'
);

select ok(
  exists (
    select 1 from public.r2_purge_queue q
    where q.object_key like 'study-content/bin-purge/%'
      and q.completed_at is null
  ),
  'unique R2 key enqueued after material purge'
);

------------------------------------------------------------------
-- 13–14) Unauthorized admin cannot permanently delete
------------------------------------------------------------------
select test_helpers.as_user((select id from t_noperm));
select throws_ok(
  format(
    'select public.purge_content(%L, %L)',
    'question',
    (select id from t_q_prot)
  ),
  'P0001',
  'permission_denied',
  'admin without edit_questions cannot purge question'
);

-- Protected question still present (unauthorized did not remove it)
select test_helpers.as_runner();
select ok(
  exists (select 1 from public.questions where id = (select id from t_q_prot)),
  'protected question untouched by unauthorized purge attempt'
);

select * from finish();
rollback;
