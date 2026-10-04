-- Restore validate_test → require_permission('publish_tests') (docs/test-rules.md,
-- docs/permissions.md). Content-bin rewrite (20261002100000) accidentally
-- reverted the gate to bare is_admin().
-- Strengthen publish_test freeze: refuse if any question_version_id stays null
-- after snapshot (checklist item 11). Same transaction — no partial publish.

create or replace function public.validate_test(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  v jsonb := '[]'::jsonb;
  n_questions int;
  n_distinct int;
  n_unapproved int;
  n_soft_deleted int;
  n_bad_content int;
  has_audience boolean;
  is_mock boolean;
begin
  perform public.require_permission('publish_tests');

  select * into t from public.tests where id = p_test_id;
  if not found then raise exception 'test not found'; end if;

  is_mock := (t.test_type = 'mock');

  select count(*), count(distinct question_id)
    into n_questions, n_distinct
  from public.test_questions
  where test_id = p_test_id;

  v := v || jsonb_build_object('check', 'question count >= ' || t.min_questions,
    'pass', n_questions >= t.min_questions and n_questions > 0,
    'detail', n_questions || ' questions');

  v := v || jsonb_build_object('check', 'no duplicate questions',
    'pass', n_questions = n_distinct,
    'detail', case when n_questions = n_distinct then 'ok'
                   else (n_questions - n_distinct) || ' duplicates' end);

  select count(*) into n_unapproved
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  where tq.test_id = p_test_id and q.status <> 'approved';
  v := v || jsonb_build_object('check', 'all questions approved',
    'pass', n_unapproved = 0, 'detail', n_unapproved || ' not approved');

  select count(*) into n_soft_deleted
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  where tq.test_id = p_test_id and q.deleted_at is not null;
  v := v || jsonb_build_object('check', 'no soft-deleted questions',
    'pass', n_soft_deleted = 0,
    'detail', n_soft_deleted || ' in Content Bin');

  select count(*) into n_bad_content
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  join public.question_versions qv on qv.id = q.current_version_id
  where tq.test_id = p_test_id
    and (
      jsonb_array_length(qv.options) not between 4 and 5
      or not exists (
        select 1 from jsonb_array_elements(qv.options) o
        where o ->> 'key' = trim(qv.correct_key::text)
      )
    );
  v := v || jsonb_build_object('check', 'options complete + valid correct keys',
    'pass', n_bad_content = 0, 'detail', n_bad_content || ' invalid');

  if is_mock then
    v := v || jsonb_build_object('check', 'valid schedule (optional for mock tests)',
      'pass', true,
      'detail', case
        when t.opens_at is null then 'no window set — mock runs year-round'
        else coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset')
      end);
  else
    v := v || jsonb_build_object('check', 'valid schedule',
      'pass', t.opens_at is not null and t.closes_at is not null
        and t.opens_at < t.closes_at and t.closes_at > now(),
      'detail', coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset'));
  end if;

  v := v || jsonb_build_object('check', 'duration > 0',
    'pass', t.duration_minutes > 0, 'detail', t.duration_minutes || ' minutes');

  if is_mock then
    v := v || jsonb_build_object('check', 'duration fits window (optional for mock tests)',
      'pass', true, 'detail', t.duration_minutes || ' minutes');
  else
    v := v || jsonb_build_object('check', 'duration fits the window',
      'pass', t.opens_at is not null and t.closes_at is not null
        and t.duration_minutes * interval '1 minute' <= (t.closes_at - t.opens_at),
      'detail', t.duration_minutes || ' minutes');
  end if;

  v := v || jsonb_build_object('check', 'valid marking scheme',
    'pass', t.marks_per_question > 0 and t.negative_mark >= 0,
    'detail', t.marks_per_question || ' per question, −' || t.negative_mark || ' per wrong');

  select exists (select 1 from public.test_audiences where test_id = p_test_id)
    or exists (select 1 from public.access_grants
      where test_id = p_test_id and grant_type = 'test' and revoked_at is null)
  into has_audience;
  v := v || jsonb_build_object('check', 'audience assigned (year or student grants)',
    'pass', has_audience,
    'detail', case when has_audience then 'ok' else 'nobody can see this test' end);

  return v;
end;
$$;

comment on function public.validate_test(uuid) is
  'Pre-publish checklist (docs/test-rules.md). Requires publish_tests. Includes no soft-deleted questions (Content Bin).';

create or replace function public.publish_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  n_unfrozen int;
begin
  perform public.require_permission('publish_tests');
  if (select status from public.tests where id = p_test_id) <> 'draft' then
    raise exception 'only draft tests can be published';
  end if;

  for item in select * from jsonb_array_elements(public.validate_test(p_test_id)) loop
    if not (item ->> 'pass')::boolean then
      raise exception 'validation failed: %', item ->> 'check';
    end if;
  end loop;

  -- freeze current versions
  update public.test_questions tq
  set question_version_id = q.current_version_id
  from public.questions q
  where tq.test_id = p_test_id and q.id = tq.question_id;

  select count(*) into n_unfrozen
  from public.test_questions
  where test_id = p_test_id and question_version_id is null;
  if n_unfrozen > 0 then
    raise exception 'validation failed: question versions freeze';
  end if;

  update public.tests set status = 'published' where id = p_test_id;

  -- refresh the UI cache flag (never authoritative)
  update public.questions q set used_in_test = true
  where q.id in (select question_id from public.test_questions where test_id = p_test_id);

  perform public.log_audit('test_published', 'test', p_test_id);
end;
$$;

comment on function public.publish_test(uuid) is
  'Validate + freeze question_version_id snapshot + status published (docs/test-rules.md). Requires publish_tests.';

revoke execute on function public.validate_test(uuid) from public, anon;
grant execute on function public.validate_test(uuid) to authenticated, service_role;

revoke execute on function public.publish_test(uuid) from public, anon;
grant execute on function public.publish_test(uuid) to authenticated, service_role;
