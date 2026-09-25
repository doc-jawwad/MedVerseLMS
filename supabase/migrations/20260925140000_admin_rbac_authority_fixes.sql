-- Staging RBAC authority fixes (do not apply to production baseline 20260924130000
-- until staging QA signs off).
-- 1) Only Main Admin may grant/revoke Main Admin (manage_admins alone is not enough).
-- 2) Fix admin_set_test_prof_session_day: non-catalog permission typo → publish_tests.
-- 3) Day-practice CSV: return existing question ids for duplicates; allow
--    manage_materials (plus import/edit) so Prof. Session CSV can insert/attach.
-- 4) MCQ bank folder SELECT: edit_questions (not bare is_admin).

-- ---------------------------------------------------------------------------
-- Main Admin grant/revoke: caller must already be Main Admin
-- ---------------------------------------------------------------------------
create or replace function public.set_main_admin(p_user_id uuid, p_is_main boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_permission('manage_admins');
  if not public.is_main_admin() then
    raise exception 'main_admin_required';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_user_id and role = 'admin'
  ) then
    raise exception 'target is not an admin';
  end if;
  if not p_is_main
     and exists (select 1 from public.profiles where id = p_user_id and is_main_admin)
     and not exists (
       select 1 from public.profiles where is_main_admin and id != p_user_id
     ) then
    raise exception 'cannot demote the last Main Admin';
  end if;
  update public.profiles
  set is_main_admin = p_is_main
  where id = p_user_id;
  perform public.log_audit(
    case when p_is_main then 'main_admin_granted' else 'main_admin_revoked' end,
    'profile',
    p_user_id,
    jsonb_build_object('is_main_admin', p_is_main)
  );
end;
$$;

comment on function public.set_main_admin(uuid, boolean) is
  'Promote/demote Main Admin. Caller must be Main Admin (and manage_admins via short-circuit). Last Main Admin cannot be demoted.';

-- ---------------------------------------------------------------------------
-- Prof. Session: attach test to day — permission typo fix
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_test_prof_session_day(
  p_test_id uuid,
  p_day_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.tests%rowtype;
  v_day public.prof_session_days%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('publish_tests')
     and not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_test from public.tests where id = p_test_id;
  if not found then
    raise exception 'test_not_found';
  end if;
  if not public.admin_can_access_year(v_test.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if p_day_id is null then
    update public.tests
    set prof_session_day_id = null
    where id = p_test_id;
    return;
  end if;

  select * into v_day from public.prof_session_days where id = p_day_id and deleted_at is null;
  if not found then
    raise exception 'day_not_found';
  end if;
  if not public.admin_can_access_year(v_day.year_id) then
    raise exception 'year_scope_denied';
  end if;
  if v_day.year_id is distinct from v_test.year_id then
    raise exception 'year_mismatch';
  end if;
  if v_test.subject_id is not null
     and v_day.subject_id is distinct from v_test.subject_id then
    raise exception 'subject_mismatch';
  end if;

  update public.tests
  set prof_session_day_id = p_day_id
  where id = p_test_id;

  perform public.log_audit(
    'test_prof_session_day_set',
    'test',
    p_test_id,
    jsonb_build_object('day_id', p_day_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Question import for Question Bank + Prof. Session day CSV
-- ---------------------------------------------------------------------------
create or replace function public.can_admin_import_questions()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('import_questions')
    or public.has_permission('edit_questions')
    or public.has_permission('manage_materials');
$$;

revoke all on function public.can_admin_import_questions() from public, anon;
grant execute on function public.can_admin_import_questions() to authenticated, service_role;

create or replace function public.create_question(
  p_topic_id uuid,
  p_stem text,
  p_options jsonb,
  p_correct_key char,
  p_explanation text default '',
  p_reference text default '',
  p_difficulty text default 'medium',
  p_tags text[] default '{}',
  p_status text default 'draft',
  p_mcq_bank_folder_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_id uuid;
  v_version_id uuid;
  v_year uuid;
  v_folder public.mcq_bank_folders%rowtype;
begin
  if not (
    public.has_permission('edit_questions')
    or public.has_permission('import_questions')
    or public.has_permission('manage_materials')
  ) then
    if not public.is_admin() then
      raise exception 'admin only';
    else
      raise exception 'permission_denied';
    end if;
  end if;
  if p_status not in ('draft', 'review', 'approved') then
    raise exception 'new questions must be draft, review or approved';
  end if;
  perform public.validate_question_content(p_options, p_correct_key);

  select year_id into v_year from public.topics where id = p_topic_id;
  if v_year is null then
    raise exception 'topic_not_found';
  end if;

  if p_mcq_bank_folder_id is not null then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
    select * into v_folder
    from public.mcq_bank_folders
    where id = p_mcq_bank_folder_id and deleted_at is null;
    if not found then
      raise exception 'mcq_bank_folder_not_found';
    end if;
    if v_folder.year_id is distinct from v_year then
      raise exception 'mcq_bank_folder_year_mismatch';
    end if;
  end if;

  insert into public.questions (
    topic_id, status, difficulty, tags, content_hash, stem_normalized,
    created_by, mcq_bank_folder_id
  )
  values (
    p_topic_id, p_status, p_difficulty, coalesce(p_tags, '{}'),
    public.question_content_hash(p_stem, p_options, p_correct_key),
    public.normalize_stem(p_stem),
    (select auth.uid()),
    p_mcq_bank_folder_id
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

create or replace function public.import_question_batch(
  p_batch_id uuid,
  p_rows jsonb,
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
  v_question_ids uuid[] := '{}';
  v_row_number int;
begin
  if not public.can_admin_import_questions() then
    if not public.is_admin() then
      raise exception 'admin only';
    else
      raise exception 'permission_denied';
    end if;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) x
    where x.value ? 'client_errors'
      and jsonb_typeof(x.value -> 'client_errors') = 'array'
      and jsonb_array_length(x.value -> 'client_errors') > 0
  ) then
    raise exception 'csv_validation_required: fix CSV errors before import';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row_number := (r ->> 'row_number')::int;
    v_question_id := null;
    v_book_id := null;
    v_chapter_id := null;
    v_topic_id := null;

    select id into v_book_id from public.books
      where subject_id = (r ->> 'subject_id')::uuid and lower(name) = lower(trim(r ->> 'book'));
    if v_book_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown book: %', v_row_number, r ->> 'book';
      end if;
      insert into public.books (subject_id, name)
      values ((r ->> 'subject_id')::uuid, trim(r ->> 'book'))
      returning id into v_book_id;
    end if;

    select id into v_chapter_id from public.chapters
      where book_id = v_book_id and lower(name) = lower(trim(r ->> 'chapter'));
    if v_chapter_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown chapter: %', v_row_number, r ->> 'chapter';
      end if;
      insert into public.chapters (book_id, name)
      values (v_book_id, trim(r ->> 'chapter'))
      returning id into v_chapter_id;
    end if;

    select id into v_topic_id from public.topics
      where chapter_id = v_chapter_id and lower(name) = lower(trim(r ->> 'topic'));
    if v_topic_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown topic: %', v_row_number, r ->> 'topic';
      end if;
      insert into public.topics (chapter_id, name)
      values (v_chapter_id, trim(r ->> 'topic'))
      returning id into v_topic_id;
    end if;

    select id into v_question_id from public.questions
      where content_hash = public.question_content_hash(
        r ->> 'stem', r -> 'options', (r ->> 'correct_key')::char(1))
      limit 1;

    if v_question_id is not null then
      v_skipped := v_skipped + 1;
      -- Still return the id so day-practice (and similar) can attach existing rows.
      v_question_ids := array_append(v_question_ids, v_question_id);
      insert into public.import_rows (batch_id, row_number, outcome, question_id)
      values (p_batch_id, v_row_number, 'skipped_duplicate', v_question_id);
      continue;
    end if;

    begin
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
    exception when others then
      raise exception 'import row % failed: %', v_row_number, SQLERRM;
    end;

    v_inserted := v_inserted + 1;
    v_question_ids := array_append(v_question_ids, v_question_id);
    insert into public.import_rows (batch_id, row_number, outcome, question_id)
    values (p_batch_id, v_row_number, 'inserted', v_question_id);
  end loop;

  update public.import_batches
  set inserted = inserted + v_inserted,
      skipped_duplicates = skipped_duplicates + v_skipped,
      errors = errors + v_errors
  where id = p_batch_id;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'errors', v_errors,
    'question_ids', to_jsonb(v_question_ids)
  );
end;
$$;

comment on function public.import_question_batch(uuid, jsonb, boolean) is
  'Bulk Question Bank CSV import. Atomic hard errors. Duplicates are skipped (not overwritten) but their ids are returned in question_ids for attach workflows. Allowed for import_questions, edit_questions, or manage_materials.';

drop policy if exists import_batches_admin_insert on public.import_batches;
create policy import_batches_admin_insert on public.import_batches
  for insert with check (public.can_admin_import_questions());

drop policy if exists import_batches_admin_update on public.import_batches;
create policy import_batches_admin_update on public.import_batches
  for update using (public.can_admin_import_questions())
  with check (public.can_admin_import_questions());

drop policy if exists import_batches_admin_delete on public.import_batches;
create policy import_batches_admin_delete on public.import_batches
  for delete using (public.can_admin_import_questions());

drop policy if exists import_batches_admin_select on public.import_batches;
create policy import_batches_admin_select on public.import_batches
  for select using (public.can_admin_import_questions());

drop policy if exists import_rows_admin_insert on public.import_rows;
create policy import_rows_admin_insert on public.import_rows
  for insert with check (public.can_admin_import_questions());

drop policy if exists import_rows_admin_update on public.import_rows;
create policy import_rows_admin_update on public.import_rows
  for update using (public.can_admin_import_questions())
  with check (public.can_admin_import_questions());

drop policy if exists import_rows_admin_delete on public.import_rows;
create policy import_rows_admin_delete on public.import_rows
  for delete using (public.can_admin_import_questions());

drop policy if exists import_rows_admin_select on public.import_rows;
create policy import_rows_admin_select on public.import_rows
  for select using (public.can_admin_import_questions());

-- ---------------------------------------------------------------------------
-- MCQ Bank folders: SELECT requires edit_questions (Main Admin short-circuits)
-- ---------------------------------------------------------------------------
drop policy if exists mcq_bank_folders_admin_select on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_select on public.mcq_bank_folders
  for select using (public.has_permission('edit_questions'));
