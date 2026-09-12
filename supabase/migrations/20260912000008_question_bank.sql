-- 0008: question bank — identity rows + immutable versions + import (docs/database.md)

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id),
  book_id uuid not null references public.books (id),
  subject_id uuid not null references public.subjects (id),
  year_id uuid not null references public.years (id),
  current_version_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approved', 'needs_revision', 'archived')),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  tags text[] not null default '{}',
  content_hash text,
  stem_normalized text,
  -- Derived UI cache ONLY. Authoritative truth = published test_questions rows.
  -- Never use for security, eligibility, or historical truth.
  used_in_test boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index questions_content_hash_unique on public.questions (content_hash)
  where content_hash is not null;
create index questions_subject_status_idx on public.questions (subject_id, status);
create index questions_chapter_idx on public.questions (chapter_id);
create index questions_topic_idx on public.questions (topic_id);
create index questions_tags_gin on public.questions using gin (tags);
create index questions_stem_trgm on public.questions using gin (stem_normalized gin_trgm_ops);

create trigger questions_updated_at before update on public.questions
  for each row execute function public.set_updated_at();

-- keep denormalized ancestors in sync with topic
create or replace function public.sync_question_ancestors()
returns trigger language plpgsql as $$
begin
  select t.chapter_id, t.book_id, t.subject_id, t.year_id
  into new.chapter_id, new.book_id, new.subject_id, new.year_id
  from public.topics t where t.id = new.topic_id;
  return new;
end; $$;

create trigger questions_sync_ancestors before insert or update of topic_id on public.questions
  for each row execute function public.sync_question_ancestors();

create table public.question_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  question_id uuid not null references public.questions (id) on delete cascade,
  version_no int not null,
  stem text not null,
  options jsonb not null,
  correct_key char(1) not null,
  explanation text not null default '',
  reference text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (question_id, version_no)
);

alter table public.questions
  add constraint questions_current_version_fk
  foreign key (current_version_id) references public.question_versions (id)
  deferrable initially deferred;

-- IMMUTABLE: versions are append-only (docs/database.md)
create or replace function public.forbid_version_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'question_versions are immutable (append-only)';
end; $$;

create trigger question_versions_immutable
  before update or delete on public.question_versions
  for each row execute function public.forbid_version_mutation();

-- validation + hash helpers
create or replace function public.validate_question_content(p_options jsonb, p_correct_key char)
returns void language plpgsql immutable as $$
declare
  v_keys text[];
begin
  if jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) not between 4 and 5 then
    raise exception 'options must be an array of 4 or 5 entries';
  end if;
  select array_agg(o ->> 'key') into v_keys from jsonb_array_elements(p_options) o;
  if array_length(array(select distinct unnest(v_keys)), 1) <> array_length(v_keys, 1) then
    raise exception 'option keys must be unique';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_options) o
    where coalesce(trim(o ->> 'text'), '') = '' or coalesce(o ->> 'key', '') = ''
  ) then
    raise exception 'every option needs a key and non-empty text';
  end if;
  if not p_correct_key = any (v_keys) then
    raise exception 'correct_key % is not one of the option keys', p_correct_key;
  end if;
end; $$;

create or replace function public.question_content_hash(p_stem text, p_options jsonb, p_correct_key char)
returns text language sql immutable as $$
  select md5(
    lower(regexp_replace(
      p_stem || '|' || p_correct_key || '|' ||
      (select string_agg(o ->> 'key' || ':' || (o ->> 'text'), '|' order by o ->> 'key')
       from jsonb_array_elements(p_options) o),
      '\s+', ' ', 'g'
    ))
  );
$$;

create or replace function public.normalize_stem(p_stem text)
returns text language sql immutable as $$
  select lower(regexp_replace(p_stem, '\s+', ' ', 'g'));
$$;

-- Create a question (identity + version 1) atomically. Admin only.
create or replace function public.create_question(
  p_topic_id uuid,
  p_stem text,
  p_options jsonb,
  p_correct_key char,
  p_explanation text default '',
  p_reference text default '',
  p_difficulty text default 'medium',
  p_tags text[] default '{}',
  p_status text default 'draft'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_id uuid;
  v_version_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_status not in ('draft', 'review', 'approved') then
    raise exception 'new questions must be draft, review or approved';
  end if;
  perform public.validate_question_content(p_options, p_correct_key);

  insert into public.questions (topic_id, status, difficulty, tags, content_hash, stem_normalized, created_by)
  values (
    p_topic_id, p_status, p_difficulty, coalesce(p_tags, '{}'),
    public.question_content_hash(p_stem, p_options, p_correct_key),
    public.normalize_stem(p_stem),
    (select auth.uid())
  )
  returning id into v_question_id;

  insert into public.question_versions
    (question_id, version_no, stem, options, correct_key, explanation, reference, created_by)
  values
    (v_question_id, 1, p_stem, p_options, p_correct_key,
     coalesce(p_explanation, ''), coalesce(p_reference, ''), (select auth.uid()))
  returning id into v_version_id;

  update public.questions set current_version_id = v_version_id where id = v_question_id;
  return v_question_id;
end;
$$;

-- Edit = append a new immutable version and repoint (docs/database.md). Admin only.
create or replace function public.create_question_version(
  p_question_id uuid,
  p_stem text,
  p_options jsonb,
  p_correct_key char,
  p_explanation text default '',
  p_reference text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version_id uuid;
  v_next int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  perform public.validate_question_content(p_options, p_correct_key);

  select coalesce(max(version_no), 0) + 1 into v_next
  from public.question_versions where question_id = p_question_id;
  if v_next = 1 then
    raise exception 'question not found';
  end if;

  insert into public.question_versions
    (question_id, version_no, stem, options, correct_key, explanation, reference, created_by)
  values
    (p_question_id, v_next, p_stem, p_options, p_correct_key,
     coalesce(p_explanation, ''), coalesce(p_reference, ''), (select auth.uid()))
  returning id into v_version_id;

  update public.questions
  set current_version_id = v_version_id,
      content_hash = public.question_content_hash(p_stem, p_options, p_correct_key),
      stem_normalized = public.normalize_stem(p_stem)
  where id = p_question_id;

  return v_version_id;
end;
$$;

-- CSV import (docs/database.md): batch of rows as jsonb, resolves/creates hierarchy
-- names under an existing subject, exact-hash duplicate skip, per-row report.
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  created_by uuid references public.profiles (id),
  filename text not null default '',
  total_rows int not null default 0,
  inserted int not null default 0,
  skipped_duplicates int not null default 0,
  errors int not null default 0,
  created_at timestamptz not null default now()
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  row_number int not null,
  outcome text not null check (outcome in ('inserted', 'skipped_duplicate', 'error')),
  error_message text,
  question_id uuid references public.questions (id) on delete set null
);

create index import_rows_batch_idx on public.import_rows (batch_id);

create or replace function public.import_question_batch(
  p_batch_id uuid,
  p_rows jsonb,           -- [{row_number, subject_id, book, chapter, topic, stem, options, correct_key, explanation, reference, difficulty, tags, status}]
  p_create_missing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_book_id uuid;
  v_chapter_id uuid;
  v_topic_id uuid;
  v_question_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_errors int := 0;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      -- resolve hierarchy by name under the given subject
      select id into v_book_id from public.books
        where subject_id = (r ->> 'subject_id')::uuid and lower(name) = lower(trim(r ->> 'book'));
      if v_book_id is null then
        if not p_create_missing then raise exception 'unknown book: %', r ->> 'book'; end if;
        insert into public.books (subject_id, name) values ((r ->> 'subject_id')::uuid, trim(r ->> 'book'))
          returning id into v_book_id;
      end if;

      select id into v_chapter_id from public.chapters
        where book_id = v_book_id and lower(name) = lower(trim(r ->> 'chapter'));
      if v_chapter_id is null then
        if not p_create_missing then raise exception 'unknown chapter: %', r ->> 'chapter'; end if;
        insert into public.chapters (book_id, name) values (v_book_id, trim(r ->> 'chapter'))
          returning id into v_chapter_id;
      end if;

      select id into v_topic_id from public.topics
        where chapter_id = v_chapter_id and lower(name) = lower(trim(r ->> 'topic'));
      if v_topic_id is null then
        if not p_create_missing then raise exception 'unknown topic: %', r ->> 'topic'; end if;
        insert into public.topics (chapter_id, name) values (v_chapter_id, trim(r ->> 'topic'))
          returning id into v_topic_id;
      end if;

      -- exact duplicate check
      if exists (
        select 1 from public.questions
        where content_hash = public.question_content_hash(
          r ->> 'stem', r -> 'options', (r ->> 'correct_key')::char(1))
      ) then
        v_skipped := v_skipped + 1;
        insert into public.import_rows (batch_id, row_number, outcome)
        values (p_batch_id, (r ->> 'row_number')::int, 'skipped_duplicate');
        continue;
      end if;

      v_status := coalesce(nullif(r ->> 'status', ''), 'draft');
      v_question_id := public.create_question(
        v_topic_id,
        r ->> 'stem',
        r -> 'options',
        (r ->> 'correct_key')::char(1),
        coalesce(r ->> 'explanation', ''),
        coalesce(r ->> 'reference', ''),
        coalesce(nullif(r ->> 'difficulty', ''), 'medium'),
        case when r ? 'tags' and jsonb_typeof(r -> 'tags') = 'array'
          then array(select jsonb_array_elements_text(r -> 'tags')) else '{}' end,
        v_status
      );

      v_inserted := v_inserted + 1;
      insert into public.import_rows (batch_id, row_number, outcome, question_id)
      values (p_batch_id, (r ->> 'row_number')::int, 'inserted', v_question_id);
    exception when others then
      v_errors := v_errors + 1;
      insert into public.import_rows (batch_id, row_number, outcome, error_message)
      values (p_batch_id, (r ->> 'row_number')::int, 'error', SQLERRM);
    end;
  end loop;

  update public.import_batches
  set inserted = inserted + v_inserted,
      skipped_duplicates = skipped_duplicates + v_skipped,
      errors = errors + v_errors
  where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

-- RLS: admin-only for now. Student access arrives via RPCs in the practice/exam phases.
alter table public.questions enable row level security;
alter table public.question_versions enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;

create policy questions_admin_all on public.questions
  for all using (public.is_admin()) with check (public.is_admin());
create policy question_versions_admin_insert on public.question_versions
  for insert with check (public.is_admin());
create policy question_versions_admin_select on public.question_versions
  for select using (public.is_admin());
create policy import_batches_admin_all on public.import_batches
  for all using (public.is_admin()) with check (public.is_admin());
create policy import_rows_admin_all on public.import_rows
  for all using (public.is_admin()) with check (public.is_admin());
