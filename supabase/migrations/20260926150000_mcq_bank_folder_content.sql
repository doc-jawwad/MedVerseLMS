-- Academic MCQ Bank folders as canonical containers: PDF materials + folder-scoped CSV import.
-- Reuses material_folders (library_type = mcq_bank) + existing R2/PDF reader path.
-- Docs: database.md mcq_bank_folders / material_folders; architecture.md MCQ Bank.

-- ---------------------------------------------------------------------------
-- 1. library_type: mcq_bank (shadow storage for folder PDFs; not a student nav type)
-- ---------------------------------------------------------------------------
alter table public.material_folders
  drop constraint if exists material_folders_library_type_check;

alter table public.material_folders
  add constraint material_folders_library_type_check
  check (library_type in (
    'guidelines',
    'los',
    'ospe_material',
    'ospe_lectures',
    'ospe_past',
    'books',
    'notes',
    'lectures',
    'syllabus',
    'schedule',
    'past_papers',
    'flashcards',
    'other_services',
    'career_counseling_series',
    'mcq_bank'
  ));

comment on column public.material_folders.library_type is
  'Folder category. mcq_bank = private PDF store for Academic MCQ Bank folders (not a separate student library).';

-- ---------------------------------------------------------------------------
-- 2. Link mcq_bank_folders → material_folders (1:1 for PDFs)
-- ---------------------------------------------------------------------------
alter table public.mcq_bank_folders
  add column if not exists material_folder_id uuid
    references public.material_folders (id)
    on delete set null;

create unique index if not exists mcq_bank_folders_material_folder_uidx
  on public.mcq_bank_folders (material_folder_id)
  where material_folder_id is not null;

comment on column public.mcq_bank_folders.material_folder_id is
  'Private material_folders row (library_type=mcq_bank) holding this folder''s PDFs.';

-- ---------------------------------------------------------------------------
-- 3. Access: MCQ Bank PDFs follow practice entitlement on the product subject
-- ---------------------------------------------------------------------------
create or replace function public.can_view_material_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.material_folders f
      where f.id = p_folder_id
        and f.deleted_at is null
        and (
          f.library_type = 'career_counseling_series'
          or (
            f.library_type = 'mcq_bank'
            and f.year_id is not null
            and public.has_active_enrollment(f.year_id)
          )
          or public.has_active_enrollment(f.year_id)
          or public.has_resource_grant('materials_folder', null, null, f.id)
        )
    );
$$;

comment on function public.can_view_material_folder(uuid) is
  'Catalog visibility. Year enrollment required except career_counseling_series. mcq_bank uses enrollment (content gated by has_practice_access).';

create or replace function public.can_access_material_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_material_folder(p_folder_id)
    and exists (
      select 1 from public.material_folders f
      where f.id = p_folder_id
        and f.deleted_at is null
        and (
          (
            f.library_type = 'mcq_bank'
            and f.subject_id is not null
            and public.has_practice_access(f.subject_id)
          )
          or public.resource_content_allowed(
            'materials_folder', null, null, f.id, f.entitlement, f.required_plan_id
          )
        )
    );
$$;

comment on function public.can_access_material_folder(uuid) is
  'Content open. mcq_bank PDFs use has_practice_access(product subject); other folders use resource_content_allowed.';

-- ---------------------------------------------------------------------------
-- 4. Ensure / sync shadow material folder
-- ---------------------------------------------------------------------------
create or replace function public.ensure_mcq_bank_material_folder(p_mcq_folder_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_folders%rowtype;
  v_mf uuid;
begin
  select * into v_row
  from public.mcq_bank_folders
  where id = p_mcq_folder_id;

  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;

  if v_row.material_folder_id is not null then
    update public.material_folders
    set
      name = v_row.name,
      year_id = v_row.year_id,
      subject_id = v_row.academic_product_subject_id,
      library_type = 'mcq_bank',
      content_surface = 'academic',
      deleted_at = case when v_row.deleted_at is null then null else deleted_at end
    where id = v_row.material_folder_id
      and deleted_at is null;
    return v_row.material_folder_id;
  end if;

  -- Insert as free only: protect_resource_entitlement blocks non-free INSERT
  -- outside set_resource_entitlement(). Student PDF open for mcq_bank is gated
  -- by has_practice_access(subject_id) in can_access_material_folder, not folder entitlement.
  insert into public.material_folders (
    year_id,
    subject_id,
    name,
    sort_order,
    library_type,
    content_surface,
    entitlement
  )
  values (
    v_row.year_id,
    v_row.academic_product_subject_id,
    v_row.name,
    v_row.sort_order,
    'mcq_bank',
    'academic',
    'free'
  )
  returning id into v_mf;

  update public.mcq_bank_folders
  set material_folder_id = v_mf
  where id = p_mcq_folder_id;

  return v_mf;
end;
$$;

revoke execute on function public.ensure_mcq_bank_material_folder(uuid) from public, anon;
grant execute on function public.ensure_mcq_bank_material_folder(uuid) to authenticated, service_role;

-- Backfill existing live folders
do $$
declare
  r record;
begin
  for r in
    select id
    from public.mcq_bank_folders
    where deleted_at is null
      and material_folder_id is null
  loop
    perform public.ensure_mcq_bank_material_folder(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Folder RPCs: create / rename / soft-delete keep material folder in sync
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_mcq_bank_folder(
  p_product_subject_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_year uuid;
  v_key text;
  v_name text := trim(coalesce(p_name, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if length(v_name) = 0 then
    raise exception 'folder_name_required';
  end if;

  select year_id, product_key into v_year, v_key
  from public.subjects where id = p_product_subject_id;
  if not found or v_key is null then
    raise exception 'academic_product_subject_required';
  end if;
  if not public.admin_can_access_year(v_year) then
    raise exception 'year_scope_denied';
  end if;

  insert into public.mcq_bank_folders (
    academic_product_subject_id, year_id, name, sort_order, created_by
  )
  values (
    p_product_subject_id,
    v_year,
    v_name,
    coalesce((
      select max(sort_order) + 1
      from public.mcq_bank_folders
      where academic_product_subject_id = p_product_subject_id
        and deleted_at is null
    ), 0),
    (select auth.uid())
  )
  returning id into v_id;

  perform public.ensure_mcq_bank_material_folder(v_id);

  perform public.log_audit(
    'mcq_bank_folder_created',
    'mcq_bank_folder',
    v_id,
    jsonb_build_object('product_subject_id', p_product_subject_id, 'name', v_name)
  );
  return v_id;
end;
$$;

create or replace function public.admin_rename_mcq_bank_folder(
  p_folder_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_folders%rowtype;
  v_name text := trim(coalesce(p_name, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if length(v_name) = 0 then
    raise exception 'folder_name_required';
  end if;

  select * into v_row from public.mcq_bank_folders where id = p_folder_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.mcq_bank_folders set name = v_name where id = p_folder_id;
  perform public.ensure_mcq_bank_material_folder(p_folder_id);

  perform public.log_audit(
    'mcq_bank_folder_renamed',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object('name', v_name)
  );
end;
$$;

create or replace function public.admin_soft_delete_mcq_bank_folder(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_folders%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
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
    select 1 from public.questions q
    where q.mcq_bank_folder_id = p_folder_id
      and q.deleted_at is null
  ) then
    raise exception 'folder_not_empty';
  end if;

  if v_row.material_folder_id is not null and exists (
    select 1 from public.materials m
    where m.folder_id = v_row.material_folder_id
      and m.deleted_at is null
  ) then
    raise exception 'folder_not_empty';
  end if;

  update public.mcq_bank_folders
  set
    deleted_at = now(),
    purge_after = now() + interval '7 days',
    deleted_by = (select auth.uid())
  where id = p_folder_id;

  if v_row.material_folder_id is not null then
    update public.material_folders
    set
      deleted_at = now(),
      purge_after = now() + interval '7 days',
      deleted_by = (select auth.uid())
    where id = v_row.material_folder_id
      and deleted_at is null;
  end if;

  perform public.log_audit(
    'mcq_bank_folder_soft_deleted',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object('name', v_row.name)
  );
end;
$$;

drop function if exists public.admin_list_mcq_bank_folders(uuid);

drop function if exists public.admin_list_mcq_bank_folders(uuid);

create or replace function public.admin_list_mcq_bank_folders(p_product_subject_id uuid)
returns table (
  folder_id uuid,
  name text,
  sort_order int,
  question_count bigint,
  material_folder_id uuid,
  pdf_count bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_year uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'admin_only';
  end if;

  select year_id into v_year from public.subjects where id = p_product_subject_id;
  if v_year is null then
    raise exception 'product_subject_not_found';
  end if;
  if not public.admin_can_access_year(v_year) then
    raise exception 'year_scope_denied';
  end if;

  return query
  select
    f.id,
    f.name,
    f.sort_order,
    (
      select count(*)::bigint
      from public.questions q
      where q.mcq_bank_folder_id = f.id
        and q.deleted_at is null
    ),
    f.material_folder_id,
    (
      select count(*)::bigint
      from public.materials m
      where f.material_folder_id is not null
        and m.folder_id = f.material_folder_id
        and m.deleted_at is null
    ),
    f.created_at
  from public.mcq_bank_folders f
  where f.academic_product_subject_id = p_product_subject_id
    and f.deleted_at is null
  order by f.sort_order, f.name, f.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Folder-scoped CSV import (optional 4th arg; taxonomy columns unchanged)
-- ---------------------------------------------------------------------------
drop function if exists public.import_question_batch(uuid, jsonb, boolean);

create or replace function public.import_question_batch(
  p_batch_id uuid,
  p_rows jsonb,
  p_create_missing boolean default true,
  p_mcq_bank_folder_id uuid default null
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
  v_folder public.mcq_bank_folders%rowtype;
begin
  if not public.can_admin_import_questions() then
    if not public.is_admin() then
      raise exception 'admin only';
    else
      raise exception 'permission_denied';
    end if;
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
    if not public.admin_can_access_year(v_folder.year_id) then
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

    -- Folder year must match taxonomy year when placing into MCQ Bank.
    if p_mcq_bank_folder_id is not null then
      if (select year_id from public.topics where id = v_topic_id) is distinct from v_folder.year_id then
        raise exception 'import row % failed: mcq_bank_folder_year_mismatch', v_row_number;
      end if;
    end if;

    select id into v_question_id from public.questions
      where content_hash = public.question_content_hash(
        r ->> 'stem', r -> 'options', (r ->> 'correct_key')::char(1))
      limit 1;

    if v_question_id is not null then
      v_skipped := v_skipped + 1;
      v_question_ids := array_append(v_question_ids, v_question_id);
      -- Folder context: attach unassigned duplicates to this folder (never reassign).
      if p_mcq_bank_folder_id is not null then
        update public.questions
        set mcq_bank_folder_id = p_mcq_bank_folder_id
        where id = v_question_id
          and mcq_bank_folder_id is null
          and deleted_at is null;
      end if;
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
        v_status,
        p_mcq_bank_folder_id
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
  'Bulk CSV import. Optional p_mcq_bank_folder_id places new/unassigned questions in that Academic MCQ Bank folder. Taxonomy book/chapter/topic unchanged. Atomic hard errors.';

revoke execute on function public.import_question_batch(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_question_batch(uuid, jsonb, boolean, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. MCQ Bank PDF upload: edit_questions may insert/update materials in mcq_bank folders
-- ---------------------------------------------------------------------------
drop policy if exists materials_admin_insert on public.materials;
create policy materials_admin_insert on public.materials
  for insert with check (
    public.has_permission('manage_materials')
    or (
      public.has_permission('edit_questions')
      and exists (
        select 1 from public.material_folders f
        where f.id = materials.folder_id
          and f.library_type = 'mcq_bank'
          and f.deleted_at is null
      )
    )
  );

drop policy if exists materials_admin_update on public.materials;
create policy materials_admin_update on public.materials
  for update using (
    public.has_permission('manage_materials')
    or (
      public.has_permission('edit_questions')
      and exists (
        select 1 from public.material_folders f
        where f.id = materials.folder_id
          and f.library_type = 'mcq_bank'
      )
    )
  )
  with check (
    public.has_permission('manage_materials')
    or (
      public.has_permission('edit_questions')
      and exists (
        select 1 from public.material_folders f
        where f.id = materials.folder_id
          and f.library_type = 'mcq_bank'
      )
    )
  );

-- material_folders: edit_questions may update mcq_bank shadow folders (name sync already via RPC)
drop policy if exists material_folders_admin_update on public.material_folders;
create policy material_folders_admin_update on public.material_folders
  for update using (
    public.has_permission('manage_materials')
    or (
      public.has_permission('edit_questions')
      and library_type = 'mcq_bank'
    )
  )
  with check (
    public.has_permission('manage_materials')
    or (
      public.has_permission('edit_questions')
      and library_type = 'mcq_bank'
    )
  );
