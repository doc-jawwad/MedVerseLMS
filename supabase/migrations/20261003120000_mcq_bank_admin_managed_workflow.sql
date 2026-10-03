-- MCQ Bank: admin-managed content (no approval gate); Main Admin cascade
-- folder/subfolder Bin; folder-scope bulk move/bin/restore for any edit_questions admin.
-- Staging-first. Production draft conversion applies only when this migration is promoted.

-- ---------------------------------------------------------------------------
-- 1) Column default + one-time draft/review → approved
-- ---------------------------------------------------------------------------
alter table public.questions
  alter column status set default 'approved';

update public.questions
set status = 'approved'
where status in ('draft', 'review');

-- Allow unarchive → approved (approval workflow retired; draft no longer required)
create or replace function public.protect_question_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('review', 'approved', 'archived'))
      or (old.status = 'review' and new.status in ('approved', 'needs_revision', 'draft', 'archived'))
      or (old.status = 'approved' and new.status in ('needs_revision', 'archived'))
      or (old.status = 'needs_revision' and new.status in ('review', 'approved', 'archived'))
      or (old.status = 'archived' and new.status in ('draft', 'approved'))
    ) then
      raise exception 'invalid question status transition: % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) create_question — always approved (API compat: p_status coerced)
-- ---------------------------------------------------------------------------
create or replace function public.create_question(
  p_topic_id uuid,
  p_stem text,
  p_options jsonb,
  p_correct_key char,
  p_explanation text default '',
  p_reference text default '',
  p_difficulty text default 'medium',
  p_tags text[] default '{}',
  p_status text default 'approved',
  p_mcq_bank_subfolder_id uuid default null
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
  v_sub public.mcq_bank_subfolders%rowtype;
  v_status text := 'approved';
begin
  if not (
    public.has_permission('edit_questions')
    or public.has_permission('import_questions')
  ) then
    if not public.is_admin() then
      raise exception 'admin only';
    else
      raise exception 'permission_denied';
    end if;
  end if;

  if p_status is not null and p_status = 'archived' then
    v_status := 'archived';
  else
    v_status := 'approved';
  end if;

  perform public.validate_question_content(p_options, p_correct_key);

  select year_id into v_year from public.topics where id = p_topic_id;
  if v_year is null then
    raise exception 'topic_not_found';
  end if;

  if p_mcq_bank_subfolder_id is not null then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
    select * into v_sub
    from public.mcq_bank_subfolders
    where id = p_mcq_bank_subfolder_id and deleted_at is null;
    if not found then
      raise exception 'mcq_bank_subfolder_not_found';
    end if;
    if v_sub.year_id is distinct from v_year then
      raise exception 'mcq_bank_subfolder_year_mismatch';
    end if;
    if not public.admin_can_access_year(v_sub.year_id) then
      raise exception 'year_scope_denied';
    end if;
  end if;

  insert into public.questions (
    topic_id, status, difficulty, tags, content_hash, stem_normalized,
    created_by, mcq_bank_subfolder_id
  )
  values (
    p_topic_id, v_status, p_difficulty, coalesce(p_tags, '{}'),
    public.question_content_hash(p_stem, p_options, p_correct_key),
    public.normalize_stem(p_stem),
    (select auth.uid()),
    p_mcq_bank_subfolder_id
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

comment on function public.create_question(uuid, text, jsonb, char, text, text, text, text[], text, uuid) is
  'Create question (+v1). Always approved (approval workflow retired). Optional p_mcq_bank_subfolder_id places into Academic MCQ Bank subfolder.';

-- ---------------------------------------------------------------------------
-- 3) import_question_batch — force approved (same body as prior; status fixed)
-- ---------------------------------------------------------------------------
create or replace function public.import_question_batch(
  p_batch_id uuid,
  p_rows jsonb,
  p_create_missing boolean default true,
  p_mcq_bank_subfolder_id uuid default null
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
  v_question_ids uuid[] := '{}';
  v_row_number int;
  v_sub public.mcq_bank_subfolders%rowtype;
begin
  if not public.can_admin_import_questions() then
    if not public.is_admin() then
      raise exception 'admin only';
    else
      raise exception 'permission_denied';
    end if;
  end if;

  if p_mcq_bank_subfolder_id is not null then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
    select * into v_sub
    from public.mcq_bank_subfolders
    where id = p_mcq_bank_subfolder_id and deleted_at is null;
    if not found then
      raise exception 'mcq_bank_subfolder_not_found';
    end if;
    if not public.admin_can_access_year(v_sub.year_id) then
      raise exception 'year_scope_denied';
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

    if p_mcq_bank_subfolder_id is not null then
      if (select year_id from public.topics where id = v_topic_id) is distinct from v_sub.year_id then
        raise exception 'import row % failed: mcq_bank_subfolder_year_mismatch', v_row_number;
      end if;
    end if;

    select id into v_question_id from public.questions
      where content_hash = public.question_content_hash(
        r ->> 'stem', r -> 'options', (r ->> 'correct_key')::char(1))
      limit 1;

    if v_question_id is not null then
      v_skipped := v_skipped + 1;
      v_question_ids := array_append(v_question_ids, v_question_id);
      if p_mcq_bank_subfolder_id is not null then
        update public.questions
        set mcq_bank_subfolder_id = p_mcq_bank_subfolder_id
        where id = v_question_id
          and mcq_bank_subfolder_id is null
          and mcq_bank_folder_id is null
          and deleted_at is null;
      end if;
      insert into public.import_rows (batch_id, row_number, outcome, question_id)
      values (p_batch_id, v_row_number, 'skipped_duplicate', v_question_id);
      continue;
    end if;

    begin
      -- Approval workflow retired: always create as approved.
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
        'approved',
        p_mcq_bank_subfolder_id
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

comment on function public.import_question_batch(uuid, jsonb, boolean, uuid) is
  'Bulk CSV import. New questions are always approved. Optional p_mcq_bank_subfolder_id places new/unassigned questions.';

-- ---------------------------------------------------------------------------
-- 4) Subfolder soft-delete — Main Admin cascade (questions share deleted_at)
-- ---------------------------------------------------------------------------
create or replace function public.admin_soft_delete_mcq_bank_subfolder(p_subfolder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_subfolders%rowtype;
  v_deleted_at timestamptz := clock_timestamp();
  v_uid uuid := (select auth.uid());
  v_q_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_main_admin() then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.mcq_bank_subfolders where id = p_subfolder_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if exists (
    select 1
    from public.questions q
    join public.test_questions tq on tq.question_id = q.id
    join public.tests t on t.id = tq.test_id
    where q.mcq_bank_subfolder_id = p_subfolder_id
      and q.deleted_at is null
      and t.status in ('published', 'closed')
  ) then
    raise exception 'question_referenced_by_active_test';
  end if;

  update public.questions
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where mcq_bank_subfolder_id = p_subfolder_id
    and deleted_at is null;
  get diagnostics v_q_count = row_count;

  update public.mcq_bank_subfolders
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where id = p_subfolder_id;

  perform public.log_audit(
    'mcq_bank_subfolder_soft_deleted',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object(
      'name', v_row.name,
      'folder_id', v_row.folder_id,
      'cascaded_questions', v_q_count,
      'deleted_at', v_deleted_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Folder soft-delete — Main Admin cascade (subfolders + MCQs + PDFs)
-- ---------------------------------------------------------------------------
create or replace function public.admin_soft_delete_mcq_bank_folder(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_folders%rowtype;
  v_deleted_at timestamptz := clock_timestamp();
  v_uid uuid := (select auth.uid());
  v_q_count int := 0;
  v_sf_count int := 0;
  v_mat_count int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_main_admin() then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.mcq_bank_folders where id = p_folder_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if exists (
    select 1
    from public.questions q
    join public.test_questions tq on tq.question_id = q.id
    join public.tests t on t.id = tq.test_id
    where q.deleted_at is null
      and t.status in ('published', 'closed')
      and (
        q.mcq_bank_folder_id = p_folder_id
        or q.mcq_bank_subfolder_id in (
          select sf.id from public.mcq_bank_subfolders sf
          where sf.folder_id = p_folder_id and sf.deleted_at is null
        )
      )
  ) then
    raise exception 'question_referenced_by_active_test';
  end if;

  update public.questions q
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where q.deleted_at is null
    and (
      q.mcq_bank_folder_id = p_folder_id
      or q.mcq_bank_subfolder_id in (
        select sf.id from public.mcq_bank_subfolders sf
        where sf.folder_id = p_folder_id and sf.deleted_at is null
      )
    );
  get diagnostics v_q_count = row_count;

  update public.mcq_bank_subfolders
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where folder_id = p_folder_id
    and deleted_at is null;
  get diagnostics v_sf_count = row_count;

  if v_row.material_folder_id is not null then
    update public.materials
    set
      deleted_at = v_deleted_at,
      purge_after = v_deleted_at + interval '7 days',
      deleted_by = v_uid
    where folder_id = v_row.material_folder_id
      and deleted_at is null;
    get diagnostics v_mat_count = row_count;

    update public.material_folders
    set
      deleted_at = v_deleted_at,
      purge_after = v_deleted_at + interval '7 days',
      deleted_by = v_uid
    where id = v_row.material_folder_id
      and deleted_at is null;
  end if;

  update public.mcq_bank_folders
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where id = p_folder_id;

  perform public.log_audit(
    'mcq_bank_folder_soft_deleted',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object(
      'name', v_row.name,
      'cascaded_questions', v_q_count,
      'cascaded_subfolders', v_sf_count,
      'cascaded_materials', v_mat_count,
      'deleted_at', v_deleted_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) restore_content — Main Admin hierarchy restore for folder/subfolder
-- ---------------------------------------------------------------------------
create or replace function public.restore_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_library_type text;
  v_folder_id uuid;
  v_deleted_at timestamptz;
  v_material_folder_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  case p_entity_type
    when 'material_folder' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id, library_type into v_year_id, v_library_type
      from public.material_folders where id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if not public.admin_year_scope_allows(v_year_id, v_library_type) then
        raise exception 'year_scope_denied';
      end if;
      update public.material_folders
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'material' then
      select m.folder_id, f.year_id, f.library_type
        into v_folder_id, v_year_id, v_library_type
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if public.has_permission('manage_materials') then
        if not public.admin_year_scope_allows(v_year_id, v_library_type) then
          raise exception 'year_scope_denied';
        end if;
      elsif public.can_admin_manage_mcq_bank_material_folder(v_folder_id) then
        null;
      else
        raise exception 'permission_denied';
      end if;
      update public.materials
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'pearl_point' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.pearl_points
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'ospe_station' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.ospe_stations
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'question' then
      if not public.has_permission('edit_questions') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.questions where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.questions
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'prof_session_day' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.prof_session_days where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.prof_session_days
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'one_liner' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.one_liners where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.one_liners
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'mcq_bank_folder' then
      if not public.is_main_admin() then
        raise exception 'permission_denied';
      end if;
      select year_id, deleted_at, material_folder_id
        into v_year_id, v_deleted_at, v_material_folder_id
      from public.mcq_bank_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if v_deleted_at is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;

      -- Restore only children that share this cascade deleted_at (not independent bins).
      update public.questions
      set deleted_at = null, purge_after = null, deleted_by = null
      where deleted_at = v_deleted_at
        and (
          mcq_bank_folder_id = p_entity_id
          or mcq_bank_subfolder_id in (
            select sf.id from public.mcq_bank_subfolders sf
            where sf.folder_id = p_entity_id
          )
        );

      update public.mcq_bank_subfolders
      set deleted_at = null, purge_after = null, deleted_by = null
      where folder_id = p_entity_id
        and deleted_at = v_deleted_at;

      if v_material_folder_id is not null then
        update public.materials
        set deleted_at = null, purge_after = null, deleted_by = null
        where folder_id = v_material_folder_id
          and deleted_at = v_deleted_at;

        update public.material_folders
        set deleted_at = null, purge_after = null, deleted_by = null
        where id = v_material_folder_id
          and deleted_at = v_deleted_at;
      end if;

      update public.mcq_bank_folders
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'mcq_bank_subfolder' then
      if not public.is_main_admin() then
        raise exception 'permission_denied';
      end if;
      select sf.year_id, sf.deleted_at into v_year_id, v_deleted_at
      from public.mcq_bank_subfolders sf
      join public.mcq_bank_folders f on f.id = sf.folder_id
      where sf.id = p_entity_id
        and sf.deleted_at is not null
        and f.deleted_at is null;
      if v_year_id is null then
        raise exception 'mcq_bank_subfolder_not_found';
      end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;

      update public.questions
      set deleted_at = null, purge_after = null, deleted_by = null
      where mcq_bank_subfolder_id = p_entity_id
        and deleted_at = v_deleted_at;

      update public.mcq_bank_subfolders
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    else
      raise exception 'unknown entity type: %', p_entity_type;
  end case;
end;
$$;

revoke all on function public.restore_content(text, uuid) from public, anon;
grant execute on function public.restore_content(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Folder bulk soft-delete (any edit_questions + year) — was stub
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_soft_delete_folder_questions(
  p_folder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_folder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
  v_ids uuid[];
  v_id uuid;
  v_expected int;
  v_binned int := 0;
  v_blocked int := 0;
  v_not_found int := 0;
  v_blocked_ids uuid[] := '{}';
  v_max int := 2000;
  v_deleted_at timestamptz := clock_timestamp();
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if p_folder_id is null then
    raise exception 'folder_required';
  end if;
  if coalesce(p_all_in_folder, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'delete_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_folder, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_folder
  from public.mcq_bank_folders
  where id = p_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_folder.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if coalesce(p_all_in_folder, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.deleted_at is null
      and (
        q.mcq_bank_folder_id = p_folder_id
        or q.mcq_bank_subfolder_id in (
          select sf.id from public.mcq_bank_subfolders sf
          where sf.folder_id = p_folder_id and sf.deleted_at is null
        )
      );
  else
    select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(p_question_ids) as x;
  end if;

  v_expected := cardinality(v_ids);
  if v_expected = 0 then
    raise exception 'no_questions_selected';
  end if;
  if v_expected > v_max then
    raise exception 'batch_too_large';
  end if;

  if (
    select count(*)::int
    from public.questions q
    where q.id = any (v_ids)
      and q.deleted_at is null
      and (
        q.mcq_bank_folder_id = p_folder_id
        or q.mcq_bank_subfolder_id in (
          select sf.id from public.mcq_bank_subfolders sf
          where sf.folder_id = p_folder_id and sf.deleted_at is null
        )
      )
  ) is distinct from v_expected then
    raise exception 'question_not_in_folder';
  end if;

  foreach v_id in array v_ids loop
    if exists (
      select 1
      from public.test_questions tq
      join public.tests t on t.id = tq.test_id
      where tq.question_id = v_id
        and t.status in ('published', 'closed')
    ) then
      v_blocked := v_blocked + 1;
      v_blocked_ids := array_append(v_blocked_ids, v_id);
      continue;
    end if;
    if not exists (select 1 from public.questions where id = v_id and deleted_at is null) then
      v_not_found := v_not_found + 1;
      continue;
    end if;
    update public.questions
    set
      deleted_at = v_deleted_at,
      purge_after = v_deleted_at + interval '7 days',
      deleted_by = v_uid
    where id = v_id and deleted_at is null;
    v_binned := v_binned + 1;
  end loop;

  perform public.log_audit(
    'mcq_bulk_soft_deleted_folder',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object(
      'binned', v_binned,
      'blocked', v_blocked,
      'all_in_folder', coalesce(p_all_in_folder, false)
    )
  );

  return jsonb_build_object(
    'binned', v_binned,
    'blocked', v_blocked,
    'not_found', v_not_found,
    'blocked_ids', to_jsonb(v_blocked_ids),
    'folder_id', p_folder_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Folder bulk move → destination subfolder (same year)
-- ---------------------------------------------------------------------------
drop function if exists public.admin_bulk_move_mcq_bank_folder_questions(uuid, uuid, uuid[], boolean);

create function public.admin_bulk_move_mcq_bank_folder_questions(
  p_source_folder_id uuid,
  p_dest_subfolder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_source boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.mcq_bank_folders%rowtype;
  v_dst public.mcq_bank_subfolders%rowtype;
  v_ids uuid[];
  v_expected int;
  v_moved int;
  v_max int := 2000;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if p_source_folder_id is null or p_dest_subfolder_id is null then
    raise exception 'folder_or_subfolder_required';
  end if;
  if coalesce(p_all_in_source, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'move_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_source, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_src
  from public.mcq_bank_folders
  where id = p_source_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_src.year_id) then
    raise exception 'year_scope_denied';
  end if;

  select * into v_dst
  from public.mcq_bank_subfolders
  where id = p_dest_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_dst.year_id) then
    raise exception 'year_scope_denied';
  end if;
  if v_dst.year_id is distinct from v_src.year_id then
    raise exception 'mcq_bank_subfolder_year_mismatch';
  end if;
  if v_dst.academic_product_subject_id is distinct from v_src.academic_product_subject_id then
    raise exception 'mcq_bank_product_mismatch';
  end if;

  if coalesce(p_all_in_source, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.deleted_at is null
      and (
        q.mcq_bank_folder_id = p_source_folder_id
        or q.mcq_bank_subfolder_id in (
          select sf.id from public.mcq_bank_subfolders sf
          where sf.folder_id = p_source_folder_id and sf.deleted_at is null
        )
      );
  else
    select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(p_question_ids) as x;
  end if;

  v_expected := cardinality(v_ids);
  if v_expected = 0 then
    raise exception 'no_questions_selected';
  end if;
  if v_expected > v_max then
    raise exception 'batch_too_large';
  end if;

  if (
    select count(*)::int
    from public.questions q
    where q.id = any (v_ids)
      and q.deleted_at is null
      and (
        q.mcq_bank_folder_id = p_source_folder_id
        or q.mcq_bank_subfolder_id in (
          select sf.id from public.mcq_bank_subfolders sf
          where sf.folder_id = p_source_folder_id and sf.deleted_at is null
        )
      )
  ) is distinct from v_expected then
    raise exception 'question_not_in_source_folder';
  end if;

  perform 1 from public.questions q where q.id = any (v_ids) for update of q;

  update public.questions
  set mcq_bank_subfolder_id = null
  where id = any (v_ids)
    and deleted_at is null;

  get diagnostics v_moved = row_count;
  if v_moved is distinct from v_expected then
    raise exception 'move_partial_aborted';
  end if;

  update public.questions
  set mcq_bank_subfolder_id = p_dest_subfolder_id
  where id = any (v_ids)
    and mcq_bank_subfolder_id is null
    and deleted_at is null;

  get diagnostics v_moved = row_count;
  if v_moved is distinct from v_expected then
    raise exception 'move_partial_aborted';
  end if;

  perform public.log_audit(
    'mcq_bulk_moved_folder',
    'mcq_bank_folder',
    p_source_folder_id,
    jsonb_build_object(
      'dest_subfolder_id', p_dest_subfolder_id,
      'moved', v_moved,
      'all_in_source', coalesce(p_all_in_source, false)
    )
  );

  return jsonb_build_object(
    'moved', v_moved,
    'source_folder_id', p_source_folder_id,
    'dest_subfolder_id', p_dest_subfolder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

-- Keep remove-from-folder stub (canonical unassign is subfolder-scoped)
create or replace function public.admin_bulk_remove_questions_from_mcq_bank_folder(
  p_folder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_folder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'mcq_bank_use_subfolder_bulk';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Bulk restore questions in subfolder / folder scope
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_restore_subfolder_questions(
  p_subfolder_id uuid,
  p_question_ids uuid[] default null,
  p_all_binned_in_subfolder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mcq_bank_subfolders%rowtype;
  v_ids uuid[];
  v_restored int;
  v_max int := 2000;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if p_subfolder_id is null then
    raise exception 'subfolder_required';
  end if;
  if coalesce(p_all_binned_in_subfolder, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'restore_selection_ambiguous';
  end if;
  if not coalesce(p_all_binned_in_subfolder, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_sub
  from public.mcq_bank_subfolders
  where id = p_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not exists (
    select 1 from public.mcq_bank_folders f
    where f.id = v_sub.folder_id and f.deleted_at is null
  ) then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_sub.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if coalesce(p_all_binned_in_subfolder, false) then
    select coalesce(array_agg(q.id order by q.deleted_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_subfolder_id = p_subfolder_id
      and q.deleted_at is not null;
  else
    select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(p_question_ids) as x;
  end if;

  if cardinality(v_ids) = 0 then
    raise exception 'no_questions_selected';
  end if;
  if cardinality(v_ids) > v_max then
    raise exception 'batch_too_large';
  end if;

  if (
    select count(*)::int
    from public.questions q
    where q.id = any (v_ids)
      and q.deleted_at is not null
      and q.mcq_bank_subfolder_id = p_subfolder_id
  ) is distinct from cardinality(v_ids) then
    raise exception 'question_not_in_subfolder';
  end if;

  update public.questions
  set deleted_at = null, purge_after = null, deleted_by = null
  where id = any (v_ids)
    and deleted_at is not null;
  get diagnostics v_restored = row_count;

  perform public.log_audit(
    'mcq_bulk_restored_subfolder',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object('restored', v_restored, 'all_binned', coalesce(p_all_binned_in_subfolder, false))
  );

  return jsonb_build_object(
    'restored', v_restored,
    'subfolder_id', p_subfolder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

create or replace function public.admin_bulk_restore_folder_questions(
  p_folder_id uuid,
  p_question_ids uuid[] default null,
  p_all_binned_in_folder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
  v_ids uuid[];
  v_restored int;
  v_max int := 2000;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if p_folder_id is null then
    raise exception 'folder_required';
  end if;
  if coalesce(p_all_binned_in_folder, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'restore_selection_ambiguous';
  end if;
  if not coalesce(p_all_binned_in_folder, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_folder
  from public.mcq_bank_folders
  where id = p_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_folder.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if coalesce(p_all_binned_in_folder, false) then
    select coalesce(array_agg(q.id order by q.deleted_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.deleted_at is not null
      and (
        q.mcq_bank_folder_id = p_folder_id
        or q.mcq_bank_subfolder_id in (
          select sf.id from public.mcq_bank_subfolders sf
          where sf.folder_id = p_folder_id
        )
      );
  else
    select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(p_question_ids) as x;
  end if;

  if cardinality(v_ids) = 0 then
    raise exception 'no_questions_selected';
  end if;
  if cardinality(v_ids) > v_max then
    raise exception 'batch_too_large';
  end if;

  if (
    select count(*)::int
    from public.questions q
    where q.id = any (v_ids)
      and q.deleted_at is not null
      and (
        q.mcq_bank_folder_id = p_folder_id
        or q.mcq_bank_subfolder_id in (
          select sf.id from public.mcq_bank_subfolders sf
          where sf.folder_id = p_folder_id
        )
      )
  ) is distinct from cardinality(v_ids) then
    raise exception 'question_not_in_folder';
  end if;

  update public.questions
  set deleted_at = null, purge_after = null, deleted_by = null
  where id = any (v_ids)
    and deleted_at is not null;
  get diagnostics v_restored = row_count;

  perform public.log_audit(
    'mcq_bulk_restored_folder',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object('restored', v_restored, 'all_binned', coalesce(p_all_binned_in_folder, false))
  );

  return jsonb_build_object(
    'restored', v_restored,
    'folder_id', p_folder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

revoke all on function public.admin_bulk_restore_subfolder_questions(uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_bulk_restore_subfolder_questions(uuid, uuid[], boolean) to authenticated, service_role;

revoke all on function public.admin_bulk_restore_folder_questions(uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_bulk_restore_folder_questions(uuid, uuid[], boolean) to authenticated, service_role;

revoke all on function public.admin_bulk_soft_delete_folder_questions(uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_bulk_soft_delete_folder_questions(uuid, uuid[], boolean) to authenticated, service_role;

revoke all on function public.admin_bulk_move_mcq_bank_folder_questions(uuid, uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_bulk_move_mcq_bank_folder_questions(uuid, uuid, uuid[], boolean) to authenticated, service_role;

revoke all on function public.create_question(uuid, text, jsonb, char, text, text, text, text[], text, uuid) from public, anon;
grant execute on function public.create_question(uuid, text, jsonb, char, text, text, text, text[], text, uuid) to authenticated, service_role;

revoke all on function public.import_question_batch(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_question_batch(uuid, jsonb, boolean, uuid) to authenticated, service_role;

revoke all on function public.admin_soft_delete_mcq_bank_folder(uuid) from public, anon;
grant execute on function public.admin_soft_delete_mcq_bank_folder(uuid) to authenticated, service_role;

revoke all on function public.admin_soft_delete_mcq_bank_subfolder(uuid) from public, anon;
grant execute on function public.admin_soft_delete_mcq_bank_subfolder(uuid) to authenticated, service_role;
