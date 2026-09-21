-- 20260922000001: Mock Test support
-- Adds test_type to tests; freezes it post-publish; adds student listing RPC.
-- Reuses the entire exam + scoring + ranking infrastructure unchanged.
-- Canonical: docs/test-rules.md (lifecycle stays identical for both types).

-- ---------------------------------------------------------------------------
-- PART A — test_type column
-- ---------------------------------------------------------------------------

alter table public.tests
  add column if not exists test_type text not null default 'formal'
  check (test_type in ('formal', 'mock'));

comment on column public.tests.test_type is
  'formal = timed competitive assessment; mock = practice / self-assessment (scheduling optional).';

create index if not exists tests_type_year_status_idx
  on public.tests (test_type, year_id, status);

-- ---------------------------------------------------------------------------
-- PART B — freeze test_type alongside other config after publish
-- ---------------------------------------------------------------------------

create or replace function public.protect_published_test()
returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' then
    if new.title is distinct from old.title
       or new.year_id is distinct from old.year_id
       or new.subject_id is distinct from old.subject_id
       or new.opens_at is distinct from old.opens_at
       or new.duration_minutes is distinct from old.duration_minutes
       or new.marks_per_question is distinct from old.marks_per_question
       or new.negative_mark is distinct from old.negative_mark
       or new.shuffle_questions is distinct from old.shuffle_questions
       or new.shuffle_options is distinct from old.shuffle_options
       or new.min_questions is distinct from old.min_questions
       or new.test_type is distinct from old.test_type then
      raise exception 'published test config is frozen (docs/test-rules.md)';
    end if;
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- PART C — relax validate_test schedule check for mock tests
-- ---------------------------------------------------------------------------
-- For mock tests the schedule window is optional: they may run year-round.
-- For formal tests the existing strict check remains.

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
  n_unapproved int;
  n_bad_content int;
  has_audience boolean;
  is_mock boolean;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  select * into t from public.tests where id = p_test_id;
  if not found then raise exception 'test not found'; end if;

  is_mock := (t.test_type = 'mock');

  select count(*) into n_questions from public.test_questions where test_id = p_test_id;
  v := v || jsonb_build_object('check', 'question count >= ' || t.min_questions,
    'pass', n_questions >= t.min_questions, 'detail', n_questions || ' questions');

  select count(*) into n_unapproved
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  where tq.test_id = p_test_id and q.status <> 'approved';
  v := v || jsonb_build_object('check', 'all questions approved',
    'pass', n_unapproved = 0, 'detail', n_unapproved || ' not approved');

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

  -- Schedule: required for formal; for mock, a missing or past window is a
  -- warning (pass = true) so publish proceeds; admins can set it for timed mocks.
  if is_mock then
    v := v || jsonb_build_object('check', 'valid schedule (optional for mock tests)',
      'pass', true,
      'detail', case
        when t.opens_at is null then 'no window set — mock runs year-round'
        else coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset')
      end);
    v := v || jsonb_build_object('check', 'duration fits window (optional for mock tests)',
      'pass', true,
      'detail', t.duration_minutes || ' minutes');
  else
    v := v || jsonb_build_object('check', 'valid schedule',
      'pass', t.opens_at is not null and t.closes_at is not null
        and t.opens_at < t.closes_at and t.closes_at > now(),
      'detail', coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset'));
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
    'pass', has_audience, 'detail', case when has_audience then 'ok' else 'nobody can see this test' end);

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- PART D — update can_access_test to allow mock tests without a live window
-- ---------------------------------------------------------------------------
-- Formal tests: status in (published, closed) and audience — unchanged.
-- Mock tests: same audience check, but no opens_at/closes_at restriction
-- (start_attempt still enforces duration from the attempt start time).

create or replace function public.can_access_test(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tests t
    where t.id = p_test_id
      and t.status in ('published', 'closed')
      and (
        exists (
          select 1 from public.test_audiences a
          join public.enrollments e
            on e.year_id = a.year_id
           and e.student_id = (select auth.uid())
           and e.status = 'active'
          where a.test_id = t.id
        )
        or exists (
          select 1 from public.access_grants g
          where g.student_id = (select auth.uid())
            and g.grant_type = 'test'
            and g.test_id = t.id
            and g.revoked_at is null
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- PART E — student listing RPC for mock tests
-- ---------------------------------------------------------------------------

create or replace function public.list_student_mock_tests()
returns table (
  test_id uuid,
  title text,
  subject_id uuid,
  subject_name text,
  product_key text,
  status text,
  duration_minutes int,
  question_count bigint,
  my_attempt_state text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.title,
    s.id,
    s.name,
    s.product_key,
    t.status,
    t.duration_minutes,
    count(tq.id),
    (
      select ta2.state
      from public.test_attempts ta2
      where ta2.test_id = t.id
        and ta2.student_id = auth.uid()
        and ta2.state <> 'invalidated'
      order by ta2.created_at desc
      limit 1
    )
  from public.tests t
  join public.subjects s on s.id = t.subject_id
  join public.test_audiences ta on ta.test_id = t.id
  join public.enrollments e
    on e.year_id = ta.year_id
   and e.student_id = auth.uid()
   and e.status = 'active'
  left join public.test_questions tq on tq.test_id = t.id
  where t.test_type = 'mock'
    and t.status in ('published', 'closed')
  group by t.id, t.title, s.id, s.name, s.product_key, t.status, t.duration_minutes
  order by s.sort_order nulls last, t.created_at desc;
$$;

revoke execute on function public.list_student_mock_tests() from public, anon;
grant execute on function public.list_student_mock_tests() to authenticated, service_role;
