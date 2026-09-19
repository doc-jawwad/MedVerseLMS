-- Enhanced validate_test checklist for the Admin Test Builder
-- (docs/test-rules.md). Adds duplicate-question and duration > 0 as
-- explicit checklist items, and gates on require_permission('publish_tests')
-- rather than bare is_admin().

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
  n_bad_content int;
  has_audience boolean;
begin
  perform public.require_permission('publish_tests');

  select * into t from public.tests where id = p_test_id;
  if not found then raise exception 'test not found'; end if;

  select count(*), count(distinct question_id)
    into n_questions, n_distinct
  from public.test_questions
  where test_id = p_test_id;

  v := v || jsonb_build_object(
    'check', 'question count >= ' || t.min_questions,
    'pass', n_questions >= t.min_questions and n_questions > 0,
    'detail', n_questions || ' questions'
  );

  v := v || jsonb_build_object(
    'check', 'no duplicate questions',
    'pass', n_questions = n_distinct,
    'detail', case
      when n_questions = n_distinct then 'ok'
      else (n_questions - n_distinct) || ' duplicates'
    end
  );

  select count(*) into n_unapproved
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  where tq.test_id = p_test_id and q.status <> 'approved';
  v := v || jsonb_build_object(
    'check', 'all questions approved',
    'pass', n_unapproved = 0,
    'detail', n_unapproved || ' not approved'
  );

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
  v := v || jsonb_build_object(
    'check', 'options complete + valid correct keys',
    'pass', n_bad_content = 0,
    'detail', n_bad_content || ' invalid'
  );

  v := v || jsonb_build_object(
    'check', 'valid schedule',
    'pass', t.opens_at is not null and t.closes_at is not null
      and t.opens_at < t.closes_at and t.closes_at > now(),
    'detail', coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset')
  );

  v := v || jsonb_build_object(
    'check', 'duration > 0',
    'pass', t.duration_minutes > 0,
    'detail', t.duration_minutes || ' minutes'
  );

  v := v || jsonb_build_object(
    'check', 'duration fits the window',
    'pass', t.opens_at is not null and t.closes_at is not null
      and t.duration_minutes * interval '1 minute' <= (t.closes_at - t.opens_at),
    'detail', t.duration_minutes || ' minutes'
  );

  v := v || jsonb_build_object(
    'check', 'valid marking scheme',
    'pass', t.marks_per_question > 0 and t.negative_mark >= 0,
    'detail', t.marks_per_question || ' per question, −' || t.negative_mark || ' per wrong'
  );

  select exists (select 1 from public.test_audiences where test_id = p_test_id)
    or exists (
      select 1 from public.access_grants
      where test_id = p_test_id and grant_type = 'test' and revoked_at is null
    )
  into has_audience;
  v := v || jsonb_build_object(
    'check', 'audience assigned (year or student grants)',
    'pass', has_audience,
    'detail', case when has_audience then 'ok' else 'nobody can see this test' end
  );

  return v;
end;
$$;

revoke execute on function public.validate_test(uuid) from public, anon;
grant execute on function public.validate_test(uuid) to authenticated, service_role;
