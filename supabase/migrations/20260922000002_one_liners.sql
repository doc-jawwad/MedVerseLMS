-- 20260922000002: One-liners content type + Pearl Points batch import
-- one_liners = single-sentence factual statements (cf. pearl_points = Q&A).
-- Used as the content engine for the prof_session_day_slots.slot_key='one_liners' slot.
-- Canonical: docs/database.md (same RLS + Bin lifecycle pattern as pearl_points).

-- ---------------------------------------------------------------------------
-- PART A — one_liners table
-- ---------------------------------------------------------------------------

create table if not exists public.one_liners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  text text not null,
  year_id uuid not null references public.years (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  chapter_id uuid references public.chapters (id) on delete set null,
  topic_id uuid references public.topics (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  sort_order int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Bin lifecycle (matches pearl_points / materials pattern)
  deleted_at timestamptz,
  purge_after timestamptz,
  deleted_by uuid references public.profiles (id),
  check (length(btrim(text)) > 0)
);

comment on table public.one_liners is
  'Single-sentence factual recall statements. Content engine for prof_session_day_slots.slot_key=one_liners.';

create index if not exists one_liners_year_status_idx on public.one_liners (year_id, status);
create index if not exists one_liners_subject_idx on public.one_liners (subject_id);
create index if not exists one_liners_deleted_at_idx on public.one_liners (deleted_at)
  where deleted_at is not null;

create trigger one_liners_updated_at
  before update on public.one_liners
  for each row execute function public.set_updated_at();

alter table public.one_liners enable row level security;

-- Admin: full CRUD scoped to years the admin can access
create policy one_liners_admin_select on public.one_liners
  for select using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

create policy one_liners_admin_insert on public.one_liners
  for insert with check (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

create policy one_liners_admin_update on public.one_liners
  for update using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  )
  with check (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

create policy one_liners_admin_delete on public.one_liners
  for delete using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

-- Students: see published non-deleted items for their enrolled year
create policy one_liners_student_select on public.one_liners
  for select using (
    status = 'published'
    and deleted_at is null
    and public.has_active_enrollment(year_id)
  );

-- Column-level grant: hide deleted_at / purge_after / deleted_by from students
revoke select on public.one_liners from public;
revoke select on public.one_liners from anon;
revoke select on public.one_liners from authenticated;
grant select (
  id,
  tenant_id,
  text,
  year_id,
  subject_id,
  chapter_id,
  topic_id,
  status,
  sort_order,
  created_at,
  updated_at
) on public.one_liners to authenticated;

-- ---------------------------------------------------------------------------
-- PART B — admin RPCs for one_liners
-- ---------------------------------------------------------------------------

create or replace function public.create_one_liner(
  p_year_id uuid,
  p_text text,
  p_subject_id uuid default null,
  p_chapter_id uuid default null,
  p_topic_id uuid default null,
  p_status text default 'draft',
  p_sort_order int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.has_permission('manage_materials') then raise exception 'permission_denied'; end if;
  if not public.admin_can_access_year(p_year_id) then raise exception 'year_scope_denied'; end if;
  if p_status not in ('draft', 'published') then raise exception 'invalid_status'; end if;
  if coalesce(btrim(p_text), '') = '' then raise exception 'text_required'; end if;

  insert into public.one_liners
    (year_id, text, subject_id, chapter_id, topic_id, status, sort_order, created_by)
  values
    (p_year_id, btrim(p_text), p_subject_id, p_chapter_id, p_topic_id,
     p_status, coalesce(p_sort_order, 0), v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_one_liner(
  p_id uuid,
  p_text text default null,
  p_subject_id uuid default null,
  p_chapter_id uuid default null,
  p_topic_id uuid default null,
  p_status text default null,
  p_sort_order int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
begin
  if not public.has_permission('manage_materials') then raise exception 'permission_denied'; end if;
  select year_id into v_year_id from public.one_liners where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
  if p_status is not null and p_status not in ('draft', 'published') then
    raise exception 'invalid_status';
  end if;

  update public.one_liners
  set
    text = coalesce(nullif(btrim(p_text), ''), text),
    subject_id = case when p_subject_id is not null then p_subject_id else subject_id end,
    chapter_id = case when p_chapter_id is not null then p_chapter_id else chapter_id end,
    topic_id = case when p_topic_id is not null then p_topic_id else topic_id end,
    status = coalesce(p_status, status),
    sort_order = coalesce(p_sort_order, sort_order)
  where id = p_id;
end;
$$;

revoke execute on function public.create_one_liner(uuid, text, uuid, uuid, uuid, text, int) from public, anon;
grant execute on function public.create_one_liner(uuid, text, uuid, uuid, uuid, text, int) to authenticated, service_role;
revoke execute on function public.update_one_liner(uuid, text, uuid, uuid, uuid, text, int) from public, anon;
grant execute on function public.update_one_liner(uuid, text, uuid, uuid, uuid, text, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PART C — CSV batch import for one_liners
-- ---------------------------------------------------------------------------
-- Row shape: {row_number, text, subject_name?, chapter_name?, topic_name?, status?}
-- subject_name / chapter_name / topic_name resolved under p_year_id.

create table if not exists public.one_liner_import_batches (
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

create table if not exists public.one_liner_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.one_liner_import_batches (id) on delete cascade,
  row_number int not null,
  outcome text not null check (outcome in ('inserted', 'skipped_duplicate', 'error')),
  error_message text,
  one_liner_id uuid references public.one_liners (id) on delete set null
);

alter table public.one_liner_import_batches enable row level security;
alter table public.one_liner_import_rows enable row level security;

create policy one_liner_import_batches_admin on public.one_liner_import_batches
  for all using (public.has_permission('manage_materials')) with check (public.has_permission('manage_materials'));
create policy one_liner_import_rows_admin on public.one_liner_import_rows
  for all using (public.has_permission('manage_materials')) with check (public.has_permission('manage_materials'));

create or replace function public.import_one_liner_batch(
  p_year_id uuid,
  p_batch_id uuid,
  p_rows jsonb -- [{row_number, text, subject_name?, chapter_name?, topic_name?, status?}]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_subject_id uuid;
  v_chapter_id uuid;
  v_topic_id uuid;
  v_one_liner_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_errors int := 0;
  v_text text;
  v_status text;
begin
  if not public.has_permission('manage_materials') then raise exception 'permission_denied'; end if;
  if not public.admin_can_access_year(p_year_id) then raise exception 'year_scope_denied'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_text := btrim(r ->> 'text');
      if v_text is null or v_text = '' then
        raise exception 'text_required';
      end if;

      -- Optional subject/chapter/topic by name
      v_subject_id := null;
      v_chapter_id := null;
      v_topic_id := null;

      if r ? 'subject_name' and (r ->> 'subject_name') <> '' then
        select id into v_subject_id from public.subjects
          where year_id = p_year_id and lower(name) = lower(trim(r ->> 'subject_name'));
      end if;

      if r ? 'chapter_name' and (r ->> 'chapter_name') <> '' and v_subject_id is not null then
        select c.id into v_chapter_id
        from public.chapters c
        join public.books b on b.id = c.book_id
        where b.subject_id = v_subject_id
          and lower(c.name) = lower(trim(r ->> 'chapter_name'))
        limit 1;
      end if;

      if r ? 'topic_name' and (r ->> 'topic_name') <> '' and v_chapter_id is not null then
        select id into v_topic_id from public.topics
          where chapter_id = v_chapter_id and lower(name) = lower(trim(r ->> 'topic_name'))
        limit 1;
      end if;

      -- Skip exact-text duplicate within same year
      if exists (
        select 1 from public.one_liners
        where year_id = p_year_id
          and lower(text) = lower(v_text)
          and deleted_at is null
      ) then
        v_skipped := v_skipped + 1;
        insert into public.one_liner_import_rows (batch_id, row_number, outcome)
        values (p_batch_id, (r ->> 'row_number')::int, 'skipped_duplicate');
        continue;
      end if;

      v_status := coalesce(nullif(r ->> 'status', ''), 'draft');

      insert into public.one_liners
        (year_id, text, subject_id, chapter_id, topic_id, status, created_by)
      values
        (p_year_id, v_text, v_subject_id, v_chapter_id, v_topic_id, v_status, auth.uid())
      returning id into v_one_liner_id;

      v_inserted := v_inserted + 1;
      insert into public.one_liner_import_rows (batch_id, row_number, outcome, one_liner_id)
      values (p_batch_id, (r ->> 'row_number')::int, 'inserted', v_one_liner_id);

    exception when others then
      v_errors := v_errors + 1;
      insert into public.one_liner_import_rows (batch_id, row_number, outcome, error_message)
      values (p_batch_id, (r ->> 'row_number')::int, 'error', sqlerrm);
    end;
  end loop;

  update public.one_liner_import_batches
  set inserted = inserted + v_inserted,
      skipped_duplicates = skipped_duplicates + v_skipped,
      errors = errors + v_errors
  where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

revoke execute on function public.import_one_liner_batch(uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_one_liner_batch(uuid, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PART D — CSV batch import for pearl_points
-- ---------------------------------------------------------------------------
-- Row shape: {row_number, prompt, answer, explanation?, year_id, subject_name, chapter_name?, topic_name?, status?}

create table if not exists public.pearl_import_batches (
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

create table if not exists public.pearl_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.pearl_import_batches (id) on delete cascade,
  row_number int not null,
  outcome text not null check (outcome in ('inserted', 'skipped_duplicate', 'error')),
  error_message text,
  pearl_id uuid references public.pearl_points (id) on delete set null
);

alter table public.pearl_import_batches enable row level security;
alter table public.pearl_import_rows enable row level security;

create policy pearl_import_batches_admin on public.pearl_import_batches
  for all using (public.has_permission('manage_materials')) with check (public.has_permission('manage_materials'));
create policy pearl_import_rows_admin on public.pearl_import_rows
  for all using (public.has_permission('manage_materials')) with check (public.has_permission('manage_materials'));

create or replace function public.import_pearl_batch(
  p_year_id uuid,
  p_batch_id uuid,
  p_rows jsonb -- [{row_number, prompt, answer, explanation?, subject_name, chapter_name?, topic_name?, status?}]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_subject_id uuid;
  v_chapter_id uuid;
  v_topic_id uuid;
  v_pearl_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_errors int := 0;
  v_prompt text;
  v_answer text;
  v_explanation text;
  v_status text;
begin
  if not public.has_permission('manage_materials') then raise exception 'permission_denied'; end if;
  if not public.admin_can_access_year(p_year_id) then raise exception 'year_scope_denied'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_prompt := btrim(r ->> 'prompt');
      v_answer := btrim(r ->> 'answer');
      if coalesce(v_prompt, '') = '' then raise exception 'prompt_required'; end if;
      if coalesce(v_answer, '') = '' then raise exception 'answer_required'; end if;

      v_explanation := coalesce(btrim(r ->> 'explanation'), '');

      -- Resolve subject
      v_subject_id := null;
      if r ? 'subject_name' and (r ->> 'subject_name') <> '' then
        select id into v_subject_id from public.subjects
          where year_id = p_year_id and lower(name) = lower(trim(r ->> 'subject_name'));
        if v_subject_id is null then
          raise exception 'unknown subject: %', r ->> 'subject_name';
        end if;
      else
        raise exception 'subject_name required';
      end if;

      -- Optional chapter/topic
      v_chapter_id := null;
      v_topic_id := null;

      if r ? 'chapter_name' and (r ->> 'chapter_name') <> '' then
        select c.id into v_chapter_id
        from public.chapters c
        join public.books b on b.id = c.book_id
        where b.subject_id = v_subject_id
          and lower(c.name) = lower(trim(r ->> 'chapter_name'))
        limit 1;
      end if;

      if r ? 'topic_name' and (r ->> 'topic_name') <> '' and v_chapter_id is not null then
        select id into v_topic_id from public.topics
          where chapter_id = v_chapter_id and lower(name) = lower(trim(r ->> 'topic_name'))
        limit 1;
      end if;

      -- Exact duplicate check (same prompt + answer in same year)
      if exists (
        select 1 from public.pearl_points
        where year_id = p_year_id
          and lower(prompt) = lower(v_prompt)
          and lower(answer) = lower(v_answer)
          and deleted_at is null
      ) then
        v_skipped := v_skipped + 1;
        insert into public.pearl_import_rows (batch_id, row_number, outcome)
        values (p_batch_id, (r ->> 'row_number')::int, 'skipped_duplicate');
        continue;
      end if;

      v_status := coalesce(nullif(r ->> 'status', ''), 'draft');

      insert into public.pearl_points
        (year_id, subject_id, chapter_id, topic_id, prompt, answer, explanation, status, created_by)
      values
        (p_year_id, v_subject_id, v_chapter_id, v_topic_id,
         v_prompt, v_answer, v_explanation, v_status, auth.uid())
      returning id into v_pearl_id;

      v_inserted := v_inserted + 1;
      insert into public.pearl_import_rows (batch_id, row_number, outcome, pearl_id)
      values (p_batch_id, (r ->> 'row_number')::int, 'inserted', v_pearl_id);

    exception when others then
      v_errors := v_errors + 1;
      insert into public.pearl_import_rows (batch_id, row_number, outcome, error_message)
      values (p_batch_id, (r ->> 'row_number')::int, 'error', sqlerrm);
    end;
  end loop;

  update public.pearl_import_batches
  set inserted = inserted + v_inserted,
      skipped_duplicates = skipped_duplicates + v_skipped,
      errors = errors + v_errors
  where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

revoke execute on function public.import_pearl_batch(uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_pearl_batch(uuid, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PART E — extend soft_delete_content + restore_content + purge_content
-- ---------------------------------------------------------------------------
-- Adds 'one_liner' as a supported entity type (append-only; existing branches unchanged).

create or replace function public.soft_delete_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('manage_materials')
    or public.has_permission('edit_questions')
  ) then
    raise exception 'permission_denied';
  end if;

  case p_entity_type
    when 'material_folder' then
      update public.material_folders
      set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = auth.uid()
      where id = p_entity_id;
    when 'material' then
      update public.materials
      set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = auth.uid()
      where id = p_entity_id;
    when 'pearl_point' then
      update public.pearl_points
      set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = auth.uid()
      where id = p_entity_id;
    when 'ospe_station' then
      update public.ospe_stations
      set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = auth.uid()
      where id = p_entity_id;
    when 'question' then
      -- Block deletion if question is in a non-draft, non-archived, non-invalidated test
      if exists (
        select 1 from public.test_questions tq
        join public.tests t on t.id = tq.test_id
        where tq.question_id = p_entity_id
          and t.status not in ('draft', 'archived', 'invalidated')
      ) then
        raise exception 'question_in_active_test';
      end if;
      update public.questions
      set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = auth.uid()
      where id = p_entity_id;
    when 'prof_session_day' then
      update public.prof_session_days
      set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = auth.uid()
      where id = p_entity_id;
    when 'one_liner' then
      update public.one_liners
      set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = auth.uid()
      where id = p_entity_id;
    else
      raise exception 'unknown entity type: %', p_entity_type;
  end case;
end;
$$;

create or replace function public.restore_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('manage_materials')
    or public.has_permission('edit_questions')
  ) then
    raise exception 'permission_denied';
  end if;

  case p_entity_type
    when 'material_folder' then
      update public.material_folders set deleted_at = null, purge_after = null, deleted_by = null where id = p_entity_id;
    when 'material' then
      update public.materials set deleted_at = null, purge_after = null, deleted_by = null where id = p_entity_id;
    when 'pearl_point' then
      update public.pearl_points set deleted_at = null, purge_after = null, deleted_by = null where id = p_entity_id;
    when 'ospe_station' then
      update public.ospe_stations set deleted_at = null, purge_after = null, deleted_by = null where id = p_entity_id;
    when 'question' then
      update public.questions set deleted_at = null, purge_after = null, deleted_by = null where id = p_entity_id;
    when 'prof_session_day' then
      update public.prof_session_days set deleted_at = null, purge_after = null, deleted_by = null where id = p_entity_id;
    when 'one_liner' then
      update public.one_liners set deleted_at = null, purge_after = null, deleted_by = null where id = p_entity_id;
    else
      raise exception 'unknown entity type: %', p_entity_type;
  end case;
end;
$$;

create or replace function public.purge_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('manage_materials')
    or public.has_permission('edit_questions')
  ) then
    raise exception 'permission_denied';
  end if;

  case p_entity_type
    when 'material_folder' then
      delete from public.material_folders where id = p_entity_id and deleted_at is not null;
    when 'material' then
      delete from public.materials where id = p_entity_id and deleted_at is not null;
    when 'pearl_point' then
      delete from public.pearl_points where id = p_entity_id and deleted_at is not null;
    when 'ospe_station' then
      delete from public.ospe_stations where id = p_entity_id and deleted_at is not null;
    when 'question' then
      -- Cannot hard-delete a question referenced by any test_questions row
      if exists (select 1 from public.test_questions where question_id = p_entity_id) then
        raise exception 'question_referenced_by_test';
      end if;
      delete from public.questions where id = p_entity_id and deleted_at is not null;
    when 'prof_session_day' then
      delete from public.prof_session_days where id = p_entity_id and deleted_at is not null;
    when 'one_liner' then
      delete from public.one_liners where id = p_entity_id and deleted_at is not null;
    else
      raise exception 'unknown entity type: %', p_entity_type;
  end case;
end;
$$;

revoke execute on function public.soft_delete_content(text, uuid) from public, anon;
grant execute on function public.soft_delete_content(text, uuid) to authenticated, service_role;
revoke execute on function public.restore_content(text, uuid) from public, anon;
grant execute on function public.restore_content(text, uuid) to authenticated, service_role;
revoke execute on function public.purge_content(text, uuid) from public, anon;
grant execute on function public.purge_content(text, uuid) to authenticated, service_role;

-- Also update list_content_bin to include one_liner rows
create or replace function public.list_content_bin(p_year_id uuid default null)
returns table (
  entity_type text,
  entity_id uuid,
  name text,
  year_id uuid,
  deleted_at timestamptz,
  purge_after timestamptz,
  deleted_by uuid,
  has_r2 boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select 'material_folder'::text, mf.id, mf.name, mf.year_id, mf.deleted_at, mf.purge_after, mf.deleted_by, false
  from public.material_folders mf
  where mf.deleted_at is not null
    and (p_year_id is null or mf.year_id = p_year_id)
    and public.admin_can_access_year(mf.year_id)
  union all
  select 'material'::text, m.id, m.title, mf2.year_id, m.deleted_at, m.purge_after, m.deleted_by,
    (m.r2_object_key is not null)
  from public.materials m
  join public.material_folders mf2 on mf2.id = m.folder_id
  where m.deleted_at is not null
    and (p_year_id is null or mf2.year_id = p_year_id)
    and public.admin_can_access_year(mf2.year_id)
  union all
  select 'pearl_point'::text, pp.id, pp.prompt, pp.year_id, pp.deleted_at, pp.purge_after, pp.deleted_by, false
  from public.pearl_points pp
  where pp.deleted_at is not null
    and (p_year_id is null or pp.year_id = p_year_id)
    and public.admin_can_access_year(pp.year_id)
  union all
  select 'ospe_station'::text, os.id, os.title, os.year_id, os.deleted_at, os.purge_after, os.deleted_by,
    (os.r2_object_key is not null)
  from public.ospe_stations os
  where os.deleted_at is not null
    and (p_year_id is null or os.year_id = p_year_id)
    and public.admin_can_access_year(os.year_id)
  union all
  select 'question'::text, q.id, left(coalesce(qv.stem, 'Untitled'), 80), q.year_id,
    q.deleted_at, q.purge_after, q.deleted_by, false
  from public.questions q
  left join public.question_versions qv on qv.id = q.current_version_id
  where q.deleted_at is not null
    and (p_year_id is null or q.year_id = p_year_id)
    and public.admin_can_access_year(q.year_id)
  union all
  select 'prof_session_day'::text, psd.id, psd.name, psd.year_id, psd.deleted_at, psd.purge_after, psd.deleted_by, false
  from public.prof_session_days psd
  where psd.deleted_at is not null
    and (p_year_id is null or psd.year_id = p_year_id)
    and public.admin_can_access_year(psd.year_id)
  union all
  select 'one_liner'::text, ol.id, left(ol.text, 80), ol.year_id, ol.deleted_at, ol.purge_after, ol.deleted_by, false
  from public.one_liners ol
  where ol.deleted_at is not null
    and (p_year_id is null or ol.year_id = p_year_id)
    and public.admin_can_access_year(ol.year_id);
$$;

revoke execute on function public.list_content_bin(uuid) from public, anon;
grant execute on function public.list_content_bin(uuid) to authenticated, service_role;
