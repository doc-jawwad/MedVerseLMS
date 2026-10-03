-- Cross-folder MCQ Move: product/year seals + identity/placement invariants.
begin;
select plan(17);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_admin('Move XF Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'Move XF Edit',
  array['edit_questions']
) as id into temp t_edit;
select test_helpers.make_limited_admin(
  'Move XF WrongYear',
  array['edit_questions']
) as id into temp t_wrong;
select test_helpers.make_limited_admin(
  'Move XF NoPerm',
  array['view_students']
) as id into temp t_noperm;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;
select id into temp t_block2
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-2'
  limit 1;

grant select on curriculum, t_year2, t_main, t_edit, t_wrong, t_noperm, t_block1, t_block2
  to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_edit),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_wrong),
  array[(select id from t_year2)]
);
select public.set_admin_year_assignments(
  (select id from t_noperm),
  array[(select year_id from curriculum)]
);

create temporary table t_fa (id uuid);
create temporary table t_fb (id uuid);
create temporary table t_fc (id uuid);
create temporary table t_sa (id uuid);
create temporary table t_sb (id uuid);
create temporary table t_sc (id uuid);
create temporary table t_q1 (id uuid);
create temporary table t_q2 (id uuid);
create temporary table t_ver1 (id uuid);
grant select, insert on t_fa, t_fb, t_fc, t_sa, t_sb, t_sc, t_q1, t_q2, t_ver1
  to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
insert into t_fa (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'XF Folder A');
insert into t_fb (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'XF Folder B');
-- Other product (same year) — must reject
insert into t_fc (id)
select public.admin_create_mcq_bank_folder((select id from t_block2), 'XF Folder Other Product');

insert into t_sa (id)
select public.admin_create_mcq_bank_subfolder((select id from t_fa), 'XF Sub A');
insert into t_sb (id)
select public.admin_create_mcq_bank_subfolder((select id from t_fb), 'XF Sub B');
insert into t_sc (id)
select public.admin_create_mcq_bank_subfolder((select id from t_fc), 'XF Sub C');

-- Single subfolder under A; cross-folder dest B must still work
insert into t_q1 (id)
select public.create_question(
  (select topic_id from curriculum),
  'XF move stem 1 ' || gen_random_uuid()::text,
  '[{"key":"A","text":"A"},{"key":"B","text":"B"},{"key":"C","text":"C"},{"key":"D","text":"D"}]'::jsonb,
  'A', '', '', 'medium', '{}', 'approved',
  (select id from t_sa)
);
insert into t_q2 (id)
select public.create_question(
  (select topic_id from curriculum),
  'XF move stem 2 ' || gen_random_uuid()::text,
  '[{"key":"A","text":"A"},{"key":"B","text":"B"},{"key":"C","text":"C"},{"key":"D","text":"D"}]'::jsonb,
  'A', '', '', 'medium', '{}', 'approved',
  (select id from t_sa)
);

insert into t_ver1 (id)
select current_version_id from public.questions where id = (select id from t_q1);

-- A. selected sibling/cross-folder move
select ok(
  (select (public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    array[(select id from t_q1)],
    false
  ) ->> 'moved')::int = 1),
  'A. selected MCQ cross-folder move'
);

select is(
  (select mcq_bank_subfolder_id from public.questions where id = (select id from t_q1)),
  (select id from t_sb),
  'A2. placement updated to dest subfolder'
);

select is(
  (select mcq_bank_folder_id from public.questions where id = (select id from t_q1)),
  (select id from t_fb),
  'A3. denormalized folder synced to dest parent'
);

-- I/J/M identity
select is(
  (select id from public.questions where id = (select id from t_q1)),
  (select id from t_q1),
  'I. question id unchanged'
);
select is(
  (select current_version_id from public.questions where id = (select id from t_q1)),
  (select id from t_ver1),
  'J. question_version unchanged'
);
select ok(
  (select deleted_at is null from public.questions where id = (select id from t_q1)),
  'M. deleted_at unchanged (still live)'
);

-- B. all-in-subfolder
select ok(
  (select (public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    null,
    true
  ) ->> 'moved')::int = 1),
  'B. all MCQs in subfolder (remaining) move cross-folder'
);

select is(
  (select count(*)::int from public.questions
   where mcq_bank_subfolder_id = (select id from t_sa) and deleted_at is null),
  0,
  'B2. source subfolder empty'
);

-- Move back via folder-scope all-in-source into Sub A (D)
select ok(
  (select (public.admin_bulk_move_mcq_bank_folder_questions(
    (select id from t_fb),
    (select id from t_sa),
    null,
    true
  ) ->> 'moved')::int = 2),
  'D. all MCQs in folder move to dest subfolder'
);

-- E. single-subfolder source with only cross-folder dest (already covered by A)
select ok(
  (select count(*)::int from public.mcq_bank_subfolders
   where folder_id = (select id from t_fa) and deleted_at is null) = 1,
  'E. folder A still has a single live subfolder'
);

-- F. wrong-year rejected
select test_helpers.as_user((select id from t_wrong));
select throws_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    array[(select id from t_q1)],
    false
  )$$,
  'P0001',
  'year_scope_denied',
  'F. wrong-year destination/source rejected'
);

-- H. permission denied
select test_helpers.as_user((select id from t_noperm));
select throws_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    array[(select id from t_q1)],
    false
  )$$,
  'P0001',
  'permission_denied',
  'H. missing edit_questions denied'
);

-- product mismatch + deleted dest
select test_helpers.as_user((select id from t_edit));
select throws_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sc),
    array[(select id from t_q1)],
    false
  )$$,
  'P0001',
  'mcq_bank_product_mismatch',
  'product mismatch rejected'
);

-- G. deleted destination rejected
select test_helpers.as_user((select id from t_main));
-- empty Sub B for soft-delete: move questions out first
select test_helpers.as_user((select id from t_edit));
select public.admin_bulk_move_mcq_bank_subfolder_questions(
  (select id from t_sb),
  (select id from t_sa),
  null,
  true
);
select test_helpers.as_user((select id from t_main));
select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sb));

select test_helpers.as_user((select id from t_edit));
select throws_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sa),
    (select id from t_sb),
    array[(select id from t_q1)],
    false
  )$$,
  'P0001',
  'mcq_bank_subfolder_not_found',
  'G. deleted destination rejected'
);

-- K/L/O: no test_questions / attempts / no duplicate rows
select is(
  (select count(*)::int from public.test_questions
   where question_version_id = (select id from t_ver1)),
  0,
  'K. test_questions unchanged (none created)'
);
select is(
  (select count(*)::int from public.attempt_answers aa
   where aa.question_version_id = (select id from t_ver1)),
  0,
  'L. attempts/answers unchanged (none)'
);
select is(
  (select count(*)::int from public.questions where id = (select id from t_q1)),
  1,
  'O. no duplicate MCQ rows'
);

select * from finish();
rollback;
