-- Admin curriculum delete: empty-node only (no subtree / question wipe).
begin;
select plan(13);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Curr Del Admin') as id into temp t_admin;
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_q;

------------------------------------------------------------------
-- Permission gate
------------------------------------------------------------------
select test_helpers.as_anon();
select throws_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'topics',
    (select topic_id from curriculum)
  ),
  'not_authenticated',
  'anon cannot delete curriculum'
);

select test_helpers.make_student((select year_id from curriculum)) as id
  into temp t_student;
select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'topics',
    (select topic_id from curriculum)
  ),
  'permission_denied',
  'student cannot delete curriculum'
);

------------------------------------------------------------------
-- Topic with questions blocked (root cause of broken UI delete)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'topics',
    (select topic_id from curriculum)
  ),
  'curriculum_has_questions',
  'topic with questions cannot be deleted'
);

-- Soft-deleted question still blocks (FK remains until Bin purge)
select test_helpers.as_runner();
update public.questions
set
  deleted_at = now(),
  purge_after = now() + interval '7 days',
  deleted_by = (select id from t_admin)
where id = (select id from t_q);

select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'topics',
    (select topic_id from curriculum)
  ),
  'curriculum_has_questions',
  'topic with soft-deleted questions still blocked'
);

-- Approved purge path clears the question, then topic delete succeeds
select lives_ok(
  format(
    'select public.purge_content(%L, %L)',
    'question',
    (select id from t_q)
  ),
  'purge soft-deleted question via Content Bin'
);

select lives_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'topics',
    (select topic_id from curriculum)
  ),
  'empty topic can be deleted'
);

select is(
  (select count(*)::int from public.topics where id = (select topic_id from curriculum)),
  0,
  'topic row removed'
);

------------------------------------------------------------------
-- Parents with children blocked (no accidental subtree wipe)
------------------------------------------------------------------
insert into public.topics (chapter_id, name)
values (
  (select chapter_id from curriculum),
  'PGTAP_curr_del_child_' || gen_random_uuid()::text
);

select throws_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'chapters',
    (select chapter_id from curriculum)
  ),
  'curriculum_has_children',
  'chapter with topics cannot be deleted'
);

select throws_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'books',
    (select book_id from curriculum)
  ),
  'curriculum_has_children',
  'book with chapters cannot be deleted'
);

select throws_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'subjects',
    (select subject_id from curriculum)
  ),
  'curriculum_has_children',
  'subject with books cannot be deleted'
);

------------------------------------------------------------------
-- Empty leaf chain: delete bottom-up
------------------------------------------------------------------
delete from public.topics where chapter_id = (select chapter_id from curriculum);

select lives_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'chapters',
    (select chapter_id from curriculum)
  ),
  'empty chapter can be deleted'
);

select lives_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'books',
    (select book_id from curriculum)
  ),
  'empty book can be deleted'
);

select lives_ok(
  format(
    'select public.admin_delete_curriculum_node(%L, %L)',
    'subjects',
    (select subject_id from curriculum)
  ),
  'empty departmental subject can be deleted'
);

select * from finish();
rollback;
