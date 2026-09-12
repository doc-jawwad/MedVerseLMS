-- 0009: practice engine (docs/database.md, plan §practice)
-- Unseen-first random batches; answers checked server-side; correct_key never
-- shipped ahead of the student's answer.

create table public.practice_seen (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  cycle int not null default 1,
  last_seen_at timestamptz not null default now(),
  unique (student_id, question_id)
);

create index practice_seen_student_idx on public.practice_seen (student_id);

create table public.practice_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  question_version_id uuid not null references public.question_versions (id),
  selected_key char(1) not null,
  is_correct boolean not null,
  subject_id uuid not null,
  chapter_id uuid not null,
  topic_id uuid not null,
  answered_at timestamptz not null default now()
);

create index practice_answers_student_subject_idx
  on public.practice_answers (student_id, subject_id);
create index practice_answers_student_time_idx
  on public.practice_answers (student_id, answered_at desc);

alter table public.practice_seen enable row level security;
alter table public.practice_answers enable row level security;

create policy practice_seen_student_select on public.practice_seen
  for select using (student_id = (select auth.uid()) or public.is_admin());
create policy practice_answers_student_select on public.practice_answers
  for select using (student_id = (select auth.uid()) or public.is_admin());
-- writes only via the definer RPCs below

-- Does the current student have practice access to this subject?
-- Requires: active enrollment in the subject's year AND an unrevoked practice grant.
create or replace function public.has_practice_access(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subjects s
    join public.enrollments e
      on e.year_id = s.year_id
     and e.student_id = (select auth.uid())
     and e.status = 'active'
    join public.access_grants g
      on g.student_id = (select auth.uid())
     and g.grant_type = 'practice_subject'
     and g.subject_id = s.id
     and g.revoked_at is null
    where s.id = p_subject_id
  );
$$;

-- Subject list for the student's practice home: name, counts, granted flag.
create or replace function public.practice_subjects()
returns table (
  subject_id uuid,
  subject_name text,
  approved_questions bigint,
  granted boolean,
  answered bigint,
  correct bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    (select count(*) from public.questions q
      where q.subject_id = s.id and q.status = 'approved') as approved_questions,
    public.has_practice_access(s.id) as granted,
    (select count(*) from public.practice_answers pa
      where pa.student_id = (select auth.uid()) and pa.subject_id = s.id) as answered,
    (select count(*) from public.practice_answers pa
      where pa.student_id = (select auth.uid()) and pa.subject_id = s.id and pa.is_correct) as correct
  from public.subjects s
  join public.enrollments e
    on e.year_id = s.year_id
   and e.student_id = (select auth.uid())
   and e.status = 'active'
  order by s.sort_order, s.name;
$$;

-- Books/chapters with approved-question counts for one granted subject.
create or replace function public.practice_subject_overview(p_subject_id uuid)
returns table (
  book_id uuid,
  book_name text,
  chapter_id uuid,
  chapter_name text,
  approved_questions bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, c.id, c.name,
    (select count(*) from public.questions q
      where q.chapter_id = c.id and q.status = 'approved')
  from public.books b
  join public.chapters c on c.book_id = b.id
  where b.subject_id = p_subject_id
    and public.has_practice_access(p_subject_id)
  order by b.sort_order, b.name, c.sort_order, c.name;
$$;

-- Serve a batch of practice questions: unseen first (cycle asc), random within
-- a cycle; serving increments practice_seen. correct_key/explanation OMITTED.
create or replace function public.get_practice_batch(
  p_scope_type text,     -- 'subject' | 'book' | 'chapter' | 'topic'
  p_scope_id uuid,
  p_limit int default 10
)
returns table (
  question_id uuid,
  question_version_id uuid,
  stem text,
  options jsonb,
  difficulty text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_subject_id uuid;
begin
  if p_scope_type not in ('subject', 'book', 'chapter', 'topic') then
    raise exception 'invalid scope type %', p_scope_type;
  end if;

  v_subject_id := case p_scope_type
    when 'subject' then p_scope_id
    when 'book' then (select subject_id from public.books where id = p_scope_id)
    when 'chapter' then (select subject_id from public.chapters where id = p_scope_id)
    when 'topic' then (select subject_id from public.topics where id = p_scope_id)
  end;

  if v_subject_id is null or not public.has_practice_access(v_subject_id) then
    raise exception 'practice_access_denied';
  end if;

  return query
  with candidates as (
    select q.id, q.current_version_id, q.difficulty
    from public.questions q
    where q.status = 'approved'
      and case p_scope_type
        when 'subject' then q.subject_id = p_scope_id
        when 'book' then q.book_id = p_scope_id
        when 'chapter' then q.chapter_id = p_scope_id
        when 'topic' then q.topic_id = p_scope_id
      end
  ),
  picked as (
    select c.id, c.current_version_id, c.difficulty
    from candidates c
    left join public.practice_seen s
      on s.question_id = c.id and s.student_id = (select auth.uid())
    order by coalesce(s.cycle, 0) asc, random()
    limit greatest(1, least(p_limit, 50))
  ),
  marked as (
    insert into public.practice_seen (student_id, question_id)
    select (select auth.uid()), p.id from picked p
    on conflict (student_id, question_id)
      do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
    returning question_id
  )
  select p.id, v.id, v.stem, v.options, p.difficulty
  from picked p
  join public.question_versions v on v.id = p.current_version_id
  join marked m on m.question_id = p.id;
end;
$$;

-- Check an answer: records it and returns the verdict + explanation.
create or replace function public.submit_practice_answer(
  p_question_version_id uuid,
  p_selected_key char
)
returns table (
  is_correct boolean,
  correct_key char,
  explanation text,
  reference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.question_versions%rowtype;
  v_question public.questions%rowtype;
  v_correct boolean;
begin
  select * into v_version from public.question_versions where id = p_question_version_id;
  if not found then
    raise exception 'question version not found';
  end if;
  select * into v_question from public.questions where id = v_version.question_id;

  if not public.has_practice_access(v_question.subject_id) then
    raise exception 'practice_access_denied';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_version.options) o
    where o ->> 'key' = p_selected_key::text
  ) then
    raise exception 'invalid option %', p_selected_key;
  end if;

  v_correct := (p_selected_key = v_version.correct_key);

  insert into public.practice_answers
    (student_id, question_version_id, selected_key, is_correct, subject_id, chapter_id, topic_id)
  values
    ((select auth.uid()), p_question_version_id, p_selected_key, v_correct,
     v_question.subject_id, v_question.chapter_id, v_question.topic_id);

  return query select v_correct, v_version.correct_key, v_version.explanation, v_version.reference;
end;
$$;
