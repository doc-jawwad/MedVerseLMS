-- Prevent wrong-year questions being attached to or published in future exams.
-- Historical published tests and their frozen attempt records remain untouched.
-- The class/year invariant is tests.year_id = questions.year_id, NOT
-- tests.subject_id = questions.subject_id (departmental subjects are valid).
--
-- No backfill, delete, trigger validation scan, or change to existing records.
-- Both functions only raise a generic constraint exception (no private content).

create function public.enforce_test_question_year_on_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_test_year uuid;
  v_question_year uuid;
begin
  select t.year_id into v_test_year
  from public.tests t where t.id = new.test_id;

  select q.year_id into v_question_year
  from public.questions q where q.id = new.question_id;

  -- Existing foreign keys handle missing test/question references.
  if v_test_year is not null and v_question_year is not null
     and v_test_year is distinct from v_question_year then
    raise exception 'test_question_year_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_test_question_year_on_link()
  from public, anon, authenticated;

create trigger test_questions_enforce_year_on_link
  before insert or update of test_id, question_id
  on public.test_questions
  for each row
  execute function public.enforce_test_question_year_on_link();

-- Defense in depth: stop publication of legacy/wrong-year draft links even
-- when the link already existed before the insert/update guard was installed.
-- The existing publish_test function freezes snapshots and then changes status;
-- raising here rolls that entire transaction back without partial publishing.
create function public.enforce_test_question_year_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.test_questions tq
    join public.questions q on q.id = tq.question_id
    where tq.test_id = new.id
      and q.year_id is distinct from new.year_id
  ) then
    raise exception 'test_question_year_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_test_question_year_on_publish()
  from public, anon, authenticated;

create trigger tests_enforce_question_year_before_publish
  before update of status on public.tests
  for each row
  when (new.status = 'published' and old.status is distinct from new.status)
  execute function public.enforce_test_question_year_on_publish();

-- Existing frozen-link protection: check both ends of a reparent.
create or replace function public.protect_published_test_questions()
returns trigger language plpgsql set search_path = public as $$
declare
  v_status text;
begin
  select status into v_status from public.tests
  where id = coalesce(new.test_id, old.test_id);

  -- A reparent changes both source and destination exam membership.
  if tg_op = 'UPDATE' and new.test_id is distinct from old.test_id then
    if v_status is distinct from 'draft' or not exists (
      select 1 from public.tests t
      where t.id = old.test_id and t.status = 'draft'
    ) then
      raise exception 'questions of a published test are frozen';
    end if;
  end if;

  if v_status <> 'draft' then
    if tg_op in ('INSERT', 'DELETE') then
      raise exception 'questions of a published test are frozen';
    end if;
    if new.question_id is distinct from old.question_id
       or new.question_version_id is distinct from old.question_version_id
       or new.position is distinct from old.position
       or new.marks is distinct from old.marks then
      raise exception 'only voiding may change on a published test';
    end if;
  end if;
  return coalesce(new, old);
end; $$;
