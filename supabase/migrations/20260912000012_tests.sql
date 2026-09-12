-- 0012: tests, test_questions, audiences, validation, snapshot publish, kill switch
-- (docs/test-rules.md is canonical for the lifecycle)

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  title text not null,
  year_id uuid not null references public.years (id),
  subject_id uuid references public.subjects (id),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'closed', 'archived', 'invalidated')),
  opens_at timestamptz,
  closes_at timestamptz,
  duration_minutes int not null default 60 check (duration_minutes > 0),
  marks_per_question numeric(6,2) not null default 1 check (marks_per_question > 0),
  negative_mark numeric(4,2) not null default 0 check (negative_mark >= 0),
  shuffle_questions boolean not null default true,
  shuffle_options boolean not null default false,
  show_review text not null default 'after_close'
    check (show_review in ('after_submit', 'after_close', 'never')),
  min_questions int not null default 1 check (min_questions >= 1),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tests_year_status_idx on public.tests (year_id, status);

create trigger tests_updated_at before update on public.tests
  for each row execute function public.set_updated_at();

create table public.test_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  test_id uuid not null references public.tests (id) on delete cascade,
  question_id uuid not null references public.questions (id),
  question_version_id uuid references public.question_versions (id), -- frozen at publish
  position int not null default 0,
  marks numeric(6,2),
  voided boolean not null default false,
  void_policy text check (void_policy in ('exclude', 'credit_all')),
  created_at timestamptz not null default now(),
  unique (test_id, question_id)
);

create index test_questions_test_idx on public.test_questions (test_id, position);

create table public.test_audiences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  test_id uuid not null references public.tests (id) on delete cascade,
  year_id uuid not null references public.years (id),
  created_at timestamptz not null default now(),
  unique (test_id, year_id)
);

alter table public.access_grants
  add constraint access_grants_test_fk
  foreign key (test_id) references public.tests (id) on delete cascade;

-- After publish, tests config is frozen: only status/closes_at may change (via RPCs).
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
       or new.min_questions is distinct from old.min_questions then
      raise exception 'published test config is frozen (docs/test-rules.md)';
    end if;
  end if;
  return new;
end; $$;

create trigger tests_protect_published before update on public.tests
  for each row execute function public.protect_published_test();

-- test_questions immutable after publish except voiding.
create or replace function public.protect_published_test_questions()
returns trigger language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status from public.tests
  where id = coalesce(new.test_id, old.test_id);

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

create trigger test_questions_protect before insert or update or delete on public.test_questions
  for each row execute function public.protect_published_test_questions();

-- Can the current student access this test? (DB-level gate for /tests/[id])
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

-- Pre-publication validation checklist (docs/test-rules.md). Each item: {check, pass, detail}.
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
  add_item boolean;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  select * into t from public.tests where id = p_test_id;
  if not found then raise exception 'test not found'; end if;

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

  v := v || jsonb_build_object('check', 'valid schedule',
    'pass', t.opens_at is not null and t.closes_at is not null
      and t.opens_at < t.closes_at and t.closes_at > now(),
    'detail', coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset'));

  v := v || jsonb_build_object('check', 'duration fits the window',
    'pass', t.opens_at is not null and t.closes_at is not null
      and t.duration_minutes * interval '1 minute' <= (t.closes_at - t.opens_at),
    'detail', t.duration_minutes || ' minutes');

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

-- Publish = validate + freeze version snapshot (docs/test-rules.md).
create or replace function public.publish_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
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

  update public.tests set status = 'published' where id = p_test_id;

  -- refresh the UI cache flag (never authoritative)
  update public.questions q set used_in_test = true
  where q.id in (select question_id from public.test_questions where test_id = p_test_id);

  perform public.log_audit('test_published', 'test', p_test_id);
end;
$$;

-- Kill switch: close now. In-progress attempts finalize via the expiry path.
create or replace function public.close_test_now(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.tests
  set closes_at = now(), status = 'closed'
  where id = p_test_id and status = 'published';
  if not found then raise exception 'test is not published'; end if;
  perform public.log_audit('test_closed_now', 'test', p_test_id);
end;
$$;

-- Kill switch: invalidate the whole test.
create or replace function public.invalidate_test(p_test_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  update public.tests set status = 'invalidated'
  where id = p_test_id and status in ('published', 'closed');
  if not found then raise exception 'test cannot be invalidated from its current state'; end if;
  perform public.log_audit('test_invalidated', 'test', p_test_id, jsonb_build_object('reason', p_reason));
end;
$$;

-- Rescoring placeholder: REPLACED in the results phase. Attempts cannot exist yet.
create or replace function public.recompute_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- no attempts before the exam engine phase; nothing to rescore yet
  null;
end;
$$;

-- Kill switch: void one question (wrong key mid-test) and rescore.
create or replace function public.void_test_question(
  p_test_id uuid, p_question_id uuid, p_policy text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_policy not in ('exclude', 'credit_all') then
    raise exception 'policy must be exclude or credit_all';
  end if;
  update public.test_questions
  set voided = true, void_policy = p_policy
  where test_id = p_test_id and question_id = p_question_id;
  if not found then raise exception 'question not in test'; end if;
  perform public.log_audit('question_voided', 'test', p_test_id,
    jsonb_build_object('question_id', p_question_id, 'policy', p_policy));
  perform public.recompute_test(p_test_id);
end;
$$;

-- RLS
alter table public.tests enable row level security;
alter table public.test_questions enable row level security;
alter table public.test_audiences enable row level security;

create policy tests_admin_all on public.tests
  for all using (public.is_admin()) with check (public.is_admin());
create policy tests_student_select on public.tests
  for select using (public.can_access_test(id));

create policy test_questions_admin_all on public.test_questions
  for all using (public.is_admin()) with check (public.is_admin());
-- students never read test_questions directly: exam RPCs only

create policy test_audiences_admin_all on public.test_audiences
  for all using (public.is_admin()) with check (public.is_admin());
