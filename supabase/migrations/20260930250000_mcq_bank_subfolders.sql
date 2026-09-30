-- Academic MCQ Bank subfolders: Folder → Subfolder → MCQs.
-- Canonical placement: questions.mcq_bank_subfolder_id
-- Denormalized parent: questions.mcq_bank_folder_id (trigger-synced)
-- Legacy folder-only rows (folder_id set, subfolder_id null) excluded from aggregates.
-- Practice unit = subfolder; folder/bank progress aggregates child subfolders.
-- Does not auto-migrate or delete legacy folder-level MCQs.

-- ===========================================================================
-- 1. mcq_bank_subfolders table
-- ===========================================================================
create table if not exists public.mcq_bank_subfolders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  folder_id uuid not null references public.mcq_bank_folders (id),
  academic_product_subject_id uuid not null references public.subjects (id),
  year_id uuid not null references public.years (id),
  name text not null,
  sort_order int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_after timestamptz,
  deleted_by uuid references public.profiles (id),
  constraint mcq_bank_subfolders_name_nonempty check (length(trim(name)) > 0)
);

comment on table public.mcq_bank_subfolders is
  'Academic MCQ Bank subfolders under a folder. Canonical MCQ container. Empty allowed. Soft-delete via Content Bin entity mcq_bank_subfolder.';

create index if not exists mcq_bank_subfolders_folder_sort_idx
  on public.mcq_bank_subfolders (folder_id, sort_order)
  where deleted_at is null;

create index if not exists mcq_bank_subfolders_year_idx
  on public.mcq_bank_subfolders (year_id)
  where deleted_at is null;

create index if not exists mcq_bank_subfolders_deleted_at_idx
  on public.mcq_bank_subfolders (deleted_at)
  where deleted_at is not null;

drop trigger if exists mcq_bank_subfolders_set_updated_at on public.mcq_bank_subfolders;
create trigger mcq_bank_subfolders_set_updated_at
  before update on public.mcq_bank_subfolders
  for each row execute function public.set_updated_at();

create or replace function public.protect_mcq_bank_subfolder_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
begin
  select * into v_folder
  from public.mcq_bank_folders
  where id = new.folder_id;

  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if v_folder.deleted_at is not null then
    raise exception 'mcq_bank_folder_deleted';
  end if;

  new.year_id := v_folder.year_id;
  new.academic_product_subject_id := v_folder.academic_product_subject_id;
  return new;
end;
$$;

drop trigger if exists trg_protect_mcq_bank_subfolder_parent on public.mcq_bank_subfolders;
create trigger trg_protect_mcq_bank_subfolder_parent
  before insert or update of folder_id
  on public.mcq_bank_subfolders
  for each row execute function public.protect_mcq_bank_subfolder_parent();

-- ===========================================================================
-- 2. questions.mcq_bank_subfolder_id + placement trigger
-- ===========================================================================
alter table public.questions
  add column if not exists mcq_bank_subfolder_id uuid
    references public.mcq_bank_subfolders (id)
    on delete set null;

comment on column public.questions.mcq_bank_subfolder_id is
  'Canonical Academic MCQ Bank placement (0 or 1 subfolder). NULL = unassigned or legacy folder-only.';

comment on column public.questions.mcq_bank_folder_id is
  'Denormalized parent folder of mcq_bank_subfolder_id (trigger-synced). Legacy rows may set this without a subfolder — excluded from new performance aggregates.';

create index if not exists questions_mcq_bank_subfolder_idx
  on public.questions (mcq_bank_subfolder_id)
  where mcq_bank_subfolder_id is not null and deleted_at is null;

create or replace function public.protect_question_mcq_bank_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mcq_bank_subfolders%rowtype;
  v_folder public.mcq_bank_folders%rowtype;
begin
  -- Subfolder A → B via raw UPDATE forbidden (use NULL then dest in RPC txn).
  if tg_op = 'UPDATE'
     and old.mcq_bank_subfolder_id is not null
     and new.mcq_bank_subfolder_id is not null
     and old.mcq_bank_subfolder_id is distinct from new.mcq_bank_subfolder_id then
    raise exception 'mcq_bank_subfolder_reassign_forbidden';
  end if;

  -- Legacy: folder A → B via raw UPDATE still forbidden when not driven by subfolder sync.
  if tg_op = 'UPDATE'
     and old.mcq_bank_folder_id is not null
     and new.mcq_bank_folder_id is not null
     and old.mcq_bank_folder_id is distinct from new.mcq_bank_folder_id
     and new.mcq_bank_subfolder_id is not distinct from old.mcq_bank_subfolder_id then
    raise exception 'mcq_bank_folder_reassign_forbidden';
  end if;

  if new.mcq_bank_subfolder_id is null then
    -- New inserts cannot place directly on a folder without a subfolder.
    if tg_op = 'INSERT' and new.mcq_bank_folder_id is not null then
      raise exception 'mcq_bank_requires_subfolder';
    end if;
    -- Unassign: clearing subfolder clears denormalized folder.
    if tg_op = 'UPDATE'
       and old.mcq_bank_subfolder_id is not null
       and new.mcq_bank_subfolder_id is null then
      new.mcq_bank_folder_id := null;
      return new;
    end if;
    if new.mcq_bank_folder_id is null then
      return new;
    end if;
    -- Legacy folder-only retain/validate.
    select * into v_folder
    from public.mcq_bank_folders
    where id = new.mcq_bank_folder_id;
    if not found then
      raise exception 'mcq_bank_folder_not_found';
    end if;
    if v_folder.deleted_at is not null then
      raise exception 'mcq_bank_folder_deleted';
    end if;
    if v_folder.year_id is distinct from new.year_id then
      raise exception 'mcq_bank_folder_year_mismatch';
    end if;
    return new;
  end if;

  select * into v_sub
  from public.mcq_bank_subfolders
  where id = new.mcq_bank_subfolder_id;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if v_sub.deleted_at is not null then
    raise exception 'mcq_bank_subfolder_deleted';
  end if;
  if v_sub.year_id is distinct from new.year_id then
    raise exception 'mcq_bank_subfolder_year_mismatch';
  end if;

  new.mcq_bank_folder_id := v_sub.folder_id;
  return new;
end;
$$;

drop trigger if exists trg_protect_question_mcq_bank_folder on public.questions;
create trigger trg_protect_question_mcq_bank_folder
  before insert or update of mcq_bank_folder_id, mcq_bank_subfolder_id, year_id
  on public.questions
  for each row execute function public.protect_question_mcq_bank_folder();

-- ===========================================================================
-- 3. RLS
-- ===========================================================================
alter table public.mcq_bank_subfolders enable row level security;

drop policy if exists mcq_bank_subfolders_admin_select on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_admin_select on public.mcq_bank_subfolders
  for select using (public.is_admin());

drop policy if exists mcq_bank_subfolders_admin_insert on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_admin_insert on public.mcq_bank_subfolders
  for insert with check (public.has_permission('edit_questions'));

drop policy if exists mcq_bank_subfolders_admin_update on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_admin_update on public.mcq_bank_subfolders
  for update using (public.has_permission('edit_questions'))
  with check (public.has_permission('edit_questions'));

drop policy if exists mcq_bank_subfolders_admin_delete on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_admin_delete on public.mcq_bank_subfolders
  for delete using (public.has_permission('edit_questions'));

drop policy if exists mcq_bank_subfolders_student_select on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_student_select on public.mcq_bank_subfolders
  for select using (
    deleted_at is null
    and public.account_allows_lms()
    and public.has_active_enrollment(year_id)
  );

grant select on public.mcq_bank_subfolders to authenticated;
grant insert, update, delete on public.mcq_bank_subfolders to authenticated;

-- ===========================================================================
-- 4. Admin subfolder CRUD
-- ===========================================================================
create or replace function public.admin_create_mcq_bank_subfolder(
  p_folder_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
  v_id uuid;
  v_name text := trim(p_name);
  v_sort int;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'name_required';
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

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.mcq_bank_subfolders
  where folder_id = p_folder_id and deleted_at is null;

  insert into public.mcq_bank_subfolders (
    folder_id, academic_product_subject_id, year_id, name, sort_order, created_by
  ) values (
    v_folder.id, v_folder.academic_product_subject_id, v_folder.year_id,
    v_name, v_sort, (select auth.uid())
  )
  returning id into v_id;

  perform public.log_audit(
    'mcq_bank_subfolder_created',
    'mcq_bank_subfolder',
    v_id,
    jsonb_build_object('folder_id', p_folder_id, 'name', v_name)
  );
  return v_id;
end;
$$;

create or replace function public.admin_rename_mcq_bank_subfolder(
  p_subfolder_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_subfolders%rowtype;
  v_name text := trim(p_name);
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'name_required';
  end if;

  select * into v_row
  from public.mcq_bank_subfolders
  where id = p_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.mcq_bank_subfolders
  set name = v_name
  where id = p_subfolder_id;

  perform public.log_audit(
    'mcq_bank_subfolder_renamed',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object('name', v_name)
  );
end;
$$;

create or replace function public.admin_reorder_mcq_bank_subfolders(
  p_folder_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
  v_id uuid;
  v_i int := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if p_ordered_ids is null or cardinality(p_ordered_ids) = 0 then
    raise exception 'ordered_ids_required';
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

  foreach v_id in array p_ordered_ids loop
    update public.mcq_bank_subfolders
    set sort_order = v_i
    where id = v_id
      and folder_id = p_folder_id
      and deleted_at is null;
    if not found then
      raise exception 'mcq_bank_subfolder_not_found';
    end if;
    v_i := v_i + 1;
  end loop;
end;
$$;

create or replace function public.admin_soft_delete_mcq_bank_subfolder(p_subfolder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_subfolders%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;

  select * into v_row
  from public.mcq_bank_subfolders
  where id = p_subfolder_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if exists (
    select 1 from public.questions q
    where q.mcq_bank_subfolder_id = p_subfolder_id
      and q.deleted_at is null
  ) then
    raise exception 'subfolder_not_empty';
  end if;

  update public.mcq_bank_subfolders
  set
    deleted_at = now(),
    purge_after = now() + interval '7 days',
    deleted_by = (select auth.uid())
  where id = p_subfolder_id;

  perform public.log_audit(
    'mcq_bank_subfolder_soft_deleted',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object('name', v_row.name, 'folder_id', v_row.folder_id)
  );
end;
$$;

create or replace function public.admin_list_mcq_bank_subfolders(p_folder_id uuid)
returns table (
  subfolder_id uuid,
  name text,
  sort_order int,
  question_count bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'admin_only';
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

  return query
  select
    sf.id,
    sf.name,
    sf.sort_order,
    (
      select count(*)::bigint
      from public.questions q
      where q.mcq_bank_subfolder_id = sf.id
        and q.deleted_at is null
    ),
    sf.created_at
  from public.mcq_bank_subfolders sf
  where sf.folder_id = p_folder_id
    and sf.deleted_at is null
  order by sf.sort_order, sf.name, sf.id;
end;
$$;

create or replace function public.admin_list_subfolder_questions(
  p_subfolder_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  question_id uuid,
  status text,
  difficulty text,
  stem text,
  subject_name text,
  topic_name text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub public.mcq_bank_subfolders%rowtype;
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_total bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'admin_only';
  end if;

  select * into v_sub
  from public.mcq_bank_subfolders
  where id = p_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_sub.year_id) then
    raise exception 'year_scope_denied';
  end if;

  select count(*) into v_total
  from public.questions q
  where q.mcq_bank_subfolder_id = p_subfolder_id
    and q.deleted_at is null;

  return query
  select
    q.id,
    q.status,
    q.difficulty,
    coalesce(qv.stem, ''),
    coalesce(s.name, ''),
    coalesce(t.name, ''),
    q.created_at,
    v_total
  from public.questions q
  left join public.question_versions qv on qv.id = q.current_version_id
  left join public.subjects s on s.id = q.subject_id
  left join public.topics t on t.id = q.topic_id
  where q.mcq_bank_subfolder_id = p_subfolder_id
    and q.deleted_at is null
  order by q.created_at desc, q.id
  limit v_limit offset v_offset;
end;
$$;

-- Folder soft-delete: refuse while live subfolders OR legacy/live questions OR PDFs remain.
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
    select 1 from public.mcq_bank_subfolders sf
    where sf.folder_id = p_folder_id and sf.deleted_at is null
  ) then
    raise exception 'folder_not_empty';
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

-- Folder list: question_count from subfolder-attached only; include subfolder_count.
drop function if exists public.admin_list_mcq_bank_folders(uuid);
create or replace function public.admin_list_mcq_bank_folders(p_product_subject_id uuid)
returns table (
  folder_id uuid,
  name text,
  sort_order int,
  question_count bigint,
  subfolder_count bigint,
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
        and q.mcq_bank_subfolder_id is not null
        and q.deleted_at is null
    ),
    (
      select count(*)::bigint
      from public.mcq_bank_subfolders sf
      where sf.folder_id = f.id
        and sf.deleted_at is null
    ),
    f.material_folder_id,
    (
      select count(*)::bigint
      from public.materials m
      where m.folder_id = f.material_folder_id
        and m.deleted_at is null
    ),
    f.created_at
  from public.mcq_bank_folders f
  where f.academic_product_subject_id = p_product_subject_id
    and f.deleted_at is null
  order by f.sort_order, f.name, f.id;
end;
$$;

-- ===========================================================================
-- 5. Assign / remove / bulk ops (subfolder-scoped)
-- ===========================================================================
create or replace function public.admin_assign_unassigned_question_to_subfolder(
  p_question_id uuid,
  p_subfolder_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.questions%rowtype;
  v_sub public.mcq_bank_subfolders%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;

  select * into v_q from public.questions where id = p_question_id and deleted_at is null;
  if not found then
    raise exception 'question_not_found';
  end if;
  if v_q.mcq_bank_subfolder_id is not null or v_q.mcq_bank_folder_id is not null then
    raise exception 'question_already_assigned';
  end if;

  select * into v_sub
  from public.mcq_bank_subfolders
  where id = p_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_sub.year_id) then
    raise exception 'year_scope_denied';
  end if;
  if v_sub.year_id is distinct from v_q.year_id then
    raise exception 'mcq_bank_subfolder_year_mismatch';
  end if;

  update public.questions
  set mcq_bank_subfolder_id = p_subfolder_id
  where id = p_question_id;

  perform public.log_audit(
    'mcq_question_assigned_subfolder',
    'question',
    p_question_id,
    jsonb_build_object('subfolder_id', p_subfolder_id, 'folder_id', v_sub.folder_id)
  );
end;
$$;

create or replace function public.admin_remove_question_from_mcq_bank_subfolder(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.questions%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;

  select * into v_q from public.questions where id = p_question_id and deleted_at is null;
  if not found then
    raise exception 'question_not_found';
  end if;
  if v_q.mcq_bank_subfolder_id is null and v_q.mcq_bank_folder_id is null then
    return;
  end if;
  if not public.admin_can_access_year(v_q.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.questions
  set mcq_bank_subfolder_id = null,
      mcq_bank_folder_id = null
  where id = p_question_id;

  perform public.log_audit(
    'mcq_question_removed_subfolder',
    'question',
    p_question_id,
    jsonb_build_object(
      'from_subfolder_id', v_q.mcq_bank_subfolder_id,
      'from_folder_id', v_q.mcq_bank_folder_id
    )
  );
end;
$$;

-- Keep old remove-from-folder name as alias that clears both columns.
create or replace function public.admin_remove_question_from_mcq_bank_folder(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_remove_question_from_mcq_bank_subfolder(p_question_id);
end;
$$;

create or replace function public.admin_bulk_move_mcq_bank_subfolder_questions(
  p_source_subfolder_id uuid,
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
  v_src public.mcq_bank_subfolders%rowtype;
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
  if p_source_subfolder_id is null or p_dest_subfolder_id is null then
    raise exception 'subfolder_required';
  end if;
  if p_source_subfolder_id = p_dest_subfolder_id then
    raise exception 'same_subfolder';
  end if;
  if coalesce(p_all_in_source, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'move_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_source, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_src
  from public.mcq_bank_subfolders
  where id = p_source_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
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

  if coalesce(p_all_in_source, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_subfolder_id = p_source_subfolder_id
      and q.deleted_at is null;
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
      and q.mcq_bank_subfolder_id = p_source_subfolder_id
  ) is distinct from v_expected then
    raise exception 'question_not_in_source_subfolder';
  end if;

  perform 1 from public.questions q where q.id = any (v_ids) for update of q;

  update public.questions
  set mcq_bank_subfolder_id = null
  where id = any (v_ids)
    and mcq_bank_subfolder_id = p_source_subfolder_id
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
    'mcq_bulk_moved_subfolder',
    'mcq_bank_subfolder',
    p_dest_subfolder_id,
    jsonb_build_object(
      'source_subfolder_id', p_source_subfolder_id,
      'dest_subfolder_id', p_dest_subfolder_id,
      'moved', v_moved,
      'all_in_source', coalesce(p_all_in_source, false)
    )
  );

  return jsonb_build_object(
    'moved', v_moved,
    'source_subfolder_id', p_source_subfolder_id,
    'dest_subfolder_id', p_dest_subfolder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

create or replace function public.admin_bulk_remove_questions_from_mcq_bank_subfolder(
  p_subfolder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_subfolder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mcq_bank_subfolders%rowtype;
  v_ids uuid[];
  v_expected int;
  v_removed int;
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
  if coalesce(p_all_in_subfolder, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'remove_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_subfolder, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_sub
  from public.mcq_bank_subfolders
  where id = p_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_sub.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if coalesce(p_all_in_subfolder, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_subfolder_id = p_subfolder_id
      and q.deleted_at is null;
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
      and q.mcq_bank_subfolder_id = p_subfolder_id
  ) is distinct from v_expected then
    raise exception 'question_not_in_subfolder';
  end if;

  update public.questions
  set mcq_bank_subfolder_id = null,
      mcq_bank_folder_id = null
  where id = any (v_ids)
    and mcq_bank_subfolder_id = p_subfolder_id
    and deleted_at is null;

  get diagnostics v_removed = row_count;
  if v_removed is distinct from v_expected then
    raise exception 'remove_partial_aborted';
  end if;

  perform public.log_audit(
    'mcq_bulk_removed_subfolder',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object('removed', v_removed, 'all_in_subfolder', coalesce(p_all_in_subfolder, false))
  );

  return jsonb_build_object(
    'removed', v_removed,
    'subfolder_id', p_subfolder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

create or replace function public.admin_bulk_soft_delete_subfolder_questions(
  p_subfolder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_subfolder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mcq_bank_subfolders%rowtype;
  v_ids uuid[];
  v_expected int;
  v_deleted int;
  v_max int := 2000;
  v_qid uuid;
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
  if coalesce(p_all_in_subfolder, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'delete_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_subfolder, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_sub
  from public.mcq_bank_subfolders
  where id = p_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_sub.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if coalesce(p_all_in_subfolder, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_subfolder_id = p_subfolder_id
      and q.deleted_at is null;
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
      and q.mcq_bank_subfolder_id = p_subfolder_id
  ) is distinct from v_expected then
    raise exception 'question_not_in_subfolder';
  end if;

  if exists (
    select 1
    from public.test_questions tq
    join public.tests t on t.id = tq.test_id
    where tq.question_id = any (v_ids)
      and t.status in ('published', 'closed')
  ) then
    raise exception 'question_referenced_by_active_test';
  end if;

  foreach v_qid in array v_ids loop
    perform public.soft_delete_content('question', v_qid);
  end loop;

  v_deleted := v_expected;

  perform public.log_audit(
    'mcq_bulk_soft_deleted_subfolder',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object('deleted', v_deleted, 'all_in_subfolder', coalesce(p_all_in_subfolder, false))
  );

  return jsonb_build_object(
    'deleted', v_deleted,
    'subfolder_id', p_subfolder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

-- Old folder bulk RPCs refuse — canonical container is subfolder.
create or replace function public.admin_bulk_move_mcq_bank_folder_questions(
  p_source_folder_id uuid,
  p_dest_folder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_source boolean default false
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
begin
  raise exception 'mcq_bank_use_subfolder_bulk';
end;
$$;

-- Fix bulk soft-delete to match folder pattern (direct soft-delete columns).
create or replace function public.admin_bulk_soft_delete_subfolder_questions(
  p_subfolder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_subfolder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mcq_bank_subfolders%rowtype;
  v_ids uuid[];
  v_id uuid;
  v_expected int;
  v_binned int := 0;
  v_blocked int := 0;
  v_not_found int := 0;
  v_blocked_ids uuid[] := '{}';
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
  if coalesce(p_all_in_subfolder, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'delete_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_subfolder, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_sub
  from public.mcq_bank_subfolders
  where id = p_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_sub.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if coalesce(p_all_in_subfolder, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_subfolder_id = p_subfolder_id
      and q.deleted_at is null;
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

  foreach v_id in array v_ids loop
    if not exists (
      select 1 from public.questions q
      where q.id = v_id
        and q.deleted_at is null
        and q.mcq_bank_subfolder_id = p_subfolder_id
    ) then
      v_not_found := v_not_found + 1;
      continue;
    end if;

    if exists (
      select 1 from public.test_questions tq
      join public.tests t on t.id = tq.test_id
      where tq.question_id = v_id
        and t.status not in ('draft', 'archived', 'invalidated')
    ) then
      v_blocked := v_blocked + 1;
      v_blocked_ids := v_blocked_ids || v_id;
      continue;
    end if;

    update public.questions
    set deleted_at = now(),
        purge_after = now() + interval '7 days',
        deleted_by = (select auth.uid())
    where id = v_id
      and deleted_at is null;

    if found then
      v_binned := v_binned + 1;
    end if;
  end loop;

  perform public.log_audit(
    'mcq_bulk_soft_deleted_subfolder',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object(
      'binned', v_binned,
      'blocked', v_blocked,
      'not_found', v_not_found,
      'all_in_subfolder', coalesce(p_all_in_subfolder, false)
    )
  );

  return jsonb_build_object(
    'binned', v_binned,
    'blocked', v_blocked,
    'not_found', v_not_found,
    'blocked_ids', to_jsonb(v_blocked_ids),
    'subfolder_id', p_subfolder_id
  );
end;
$$;

create or replace function public.admin_assign_unassigned_question_to_folder(
  p_question_id uuid,
  p_folder_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'mcq_bank_requires_subfolder';
end;
$$;

-- ===========================================================================
-- 6. create_question + import_question_batch → subfolder target
-- ===========================================================================
-- Parameter rename requires DROP (CREATE OR REPLACE cannot rename args).
drop function if exists public.create_question(uuid, text, jsonb, char, text, text, text, text[], text, uuid);
drop function if exists public.import_question_batch(uuid, jsonb, boolean, uuid);

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
  if p_status not in ('draft', 'review', 'approved') then
    raise exception 'new questions must be draft, review or approved';
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
    p_topic_id, p_status, p_difficulty, coalesce(p_tags, '{}'),
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
  v_status text;
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
  'Bulk CSV import. Optional p_mcq_bank_subfolder_id places new/unassigned questions in that Academic MCQ Bank subfolder. Taxonomy unchanged. Atomic hard errors.';

comment on function public.create_question(uuid, text, jsonb, char, text, text, text, text[], text, uuid) is
  'Create question (+v1). Optional p_mcq_bank_subfolder_id places into Academic MCQ Bank subfolder (folder_id denormalized by trigger).';

-- ===========================================================================
-- 7. Practice access + progress + reset (subfolder + folder aggregate)
-- ===========================================================================
create or replace function public.can_access_mcq_bank_subfolder_practice(p_subfolder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mcq_bank_subfolders sf
    join public.mcq_bank_folders f on f.id = sf.folder_id
    where sf.id = p_subfolder_id
      and sf.deleted_at is null
      and f.deleted_at is null
      and public.can_access_mcq_bank_folder_practice(f.id)
  );
$$;

comment on function public.can_access_mcq_bank_subfolder_practice(uuid) is
  'True when caller may practice a live MCQ Bank subfolder: parent folder passes can_access_mcq_bank_folder_practice. Favorites/Incorrect are not entitlement.';

create or replace function public.get_mcq_bank_subfolder_practice_progress(p_subfolder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_total bigint;
  v_done bigint;
  v_favorites bigint;
  v_incorrect bigint;
  v_remaining bigint;
  v_percent int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not exists (
    select 1 from public.mcq_bank_subfolders sf
    where sf.id = p_subfolder_id and sf.deleted_at is null
  ) then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.can_access_mcq_bank_subfolder_practice(p_subfolder_id) then
    raise exception 'practice_access_denied';
  end if;

  select count(*) into v_total
  from public.questions q
  where q.mcq_bank_subfolder_id = p_subfolder_id
    and q.status = 'approved'
    and q.deleted_at is null;

  select count(*) into v_done
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.state = 'done'
  where q.mcq_bank_subfolder_id = p_subfolder_id
    and q.status = 'approved'
    and q.deleted_at is null;

  select count(*) into v_favorites
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.marked = true
  where q.mcq_bank_subfolder_id = p_subfolder_id
    and q.status = 'approved'
    and q.deleted_at is null;

  select count(*) into v_incorrect
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.incorrect = true
  where q.mcq_bank_subfolder_id = p_subfolder_id
    and q.status = 'approved'
    and q.deleted_at is null;

  v_remaining := greatest(v_total - v_done, 0);
  if v_total <= 0 or v_done <= 0 then
    v_percent := 0;
  else
    v_percent := round((100.0 * least(v_done, v_total)) / v_total)::int;
  end if;

  return jsonb_build_object(
    'subfolder_id', p_subfolder_id,
    'total', v_total,
    'done', v_done,
    'remaining', v_remaining,
    'percent_complete', v_percent,
    'complete', (v_total > 0 and v_done >= v_total),
    'favorites', v_favorites,
    'incorrect', v_incorrect
  );
end;
$$;

create or replace function public.list_mcq_bank_subfolder_practice_progress(p_folder_id uuid)
returns table (
  subfolder_id uuid,
  name text,
  sort_order int,
  total bigint,
  done bigint,
  remaining bigint,
  percent_complete int,
  complete boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not exists (
    select 1 from public.mcq_bank_folders f
    where f.id = p_folder_id and f.deleted_at is null
  ) then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.can_access_mcq_bank_folder_practice(p_folder_id) then
    raise exception 'practice_access_denied';
  end if;

  return query
  select
    sf.id,
    sf.name,
    sf.sort_order,
    coalesce(t.total, 0)::bigint,
    coalesce(t.done, 0)::bigint,
    greatest(coalesce(t.total, 0) - coalesce(t.done, 0), 0)::bigint,
    case
      when coalesce(t.total, 0) <= 0 or coalesce(t.done, 0) <= 0 then 0
      else round((100.0 * least(t.done, t.total)) / t.total)::int
    end,
    (coalesce(t.total, 0) > 0 and coalesce(t.done, 0) >= t.total)
  from public.mcq_bank_subfolders sf
  left join lateral (
    select
      count(*)::bigint as total,
      count(*) filter (
        where exists (
          select 1
          from public.practice_progress pp
          where pp.student_id = v_uid
            and pp.item_kind = 'question'
            and pp.item_id = q.id
            and pp.state = 'done'
        )
      )::bigint as done
    from public.questions q
    where q.mcq_bank_subfolder_id = sf.id
      and q.status = 'approved'
      and q.deleted_at is null
  ) t on true
  where sf.folder_id = p_folder_id
    and sf.deleted_at is null
  order by sf.sort_order, sf.name, sf.id;
end;
$$;

-- Folder progress = aggregate of subfolder-attached questions only (exclude legacy).
create or replace function public.get_mcq_bank_folder_practice_progress(p_folder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_total bigint;
  v_done bigint;
  v_favorites bigint;
  v_incorrect bigint;
  v_remaining bigint;
  v_percent int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not exists (
    select 1 from public.mcq_bank_folders f
    where f.id = p_folder_id and f.deleted_at is null
  ) then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.can_access_mcq_bank_folder_practice(p_folder_id) then
    raise exception 'practice_access_denied';
  end if;

  select count(*) into v_total
  from public.questions q
  where q.mcq_bank_folder_id = p_folder_id
    and q.mcq_bank_subfolder_id is not null
    and q.status = 'approved'
    and q.deleted_at is null;

  select count(*) into v_done
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.state = 'done'
  where q.mcq_bank_folder_id = p_folder_id
    and q.mcq_bank_subfolder_id is not null
    and q.status = 'approved'
    and q.deleted_at is null;

  select count(*) into v_favorites
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.marked = true
  where q.mcq_bank_folder_id = p_folder_id
    and q.mcq_bank_subfolder_id is not null
    and q.status = 'approved'
    and q.deleted_at is null;

  select count(*) into v_incorrect
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.incorrect = true
  where q.mcq_bank_folder_id = p_folder_id
    and q.mcq_bank_subfolder_id is not null
    and q.status = 'approved'
    and q.deleted_at is null;

  v_remaining := greatest(v_total - v_done, 0);
  if v_total <= 0 or v_done <= 0 then
    v_percent := 0;
  else
    v_percent := round((100.0 * least(v_done, v_total)) / v_total)::int;
  end if;

  return jsonb_build_object(
    'folder_id', p_folder_id,
    'total', v_total,
    'done', v_done,
    'remaining', v_remaining,
    'percent_complete', v_percent,
    'complete', (v_total > 0 and v_done >= v_total),
    'favorites', v_favorites,
    'incorrect', v_incorrect
  );
end;
$$;

create or replace function public.list_mcq_bank_folder_practice_progress(
  p_product_subject_id uuid
)
returns table (
  folder_id uuid,
  name text,
  sort_order int,
  total bigint,
  done bigint,
  remaining bigint,
  percent_complete int,
  complete boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select year_id into v_year from public.subjects where id = p_product_subject_id;
  if v_year is null then
    raise exception 'product_subject_not_found';
  end if;
  if not public.has_active_enrollment(v_year) then
    raise exception 'practice_access_denied';
  end if;
  if not public.has_practice_access(p_product_subject_id) then
    raise exception 'practice_access_denied';
  end if;

  return query
  select
    f.id,
    f.name,
    f.sort_order,
    coalesce(t.total, 0)::bigint,
    coalesce(t.done, 0)::bigint,
    greatest(coalesce(t.total, 0) - coalesce(t.done, 0), 0)::bigint,
    case
      when coalesce(t.total, 0) <= 0 or coalesce(t.done, 0) <= 0 then 0
      else round((100.0 * least(t.done, t.total)) / t.total)::int
    end,
    (coalesce(t.total, 0) > 0 and coalesce(t.done, 0) >= t.total)
  from public.mcq_bank_folders f
  left join lateral (
    select
      count(*)::bigint as total,
      count(*) filter (
        where exists (
          select 1
          from public.practice_progress pp
          where pp.student_id = v_uid
            and pp.item_kind = 'question'
            and pp.item_id = q.id
            and pp.state = 'done'
        )
      )::bigint as done
    from public.questions q
    where q.mcq_bank_folder_id = f.id
      and q.mcq_bank_subfolder_id is not null
      and q.status = 'approved'
      and q.deleted_at is null
  ) t on true
  where f.academic_product_subject_id = p_product_subject_id
    and f.deleted_at is null
  order by f.sort_order, f.name, f.id;
end;
$$;

-- Bank-level aggregate across all folders/subfolders under a product subject.
create or replace function public.get_mcq_bank_product_practice_progress(p_product_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year uuid;
  v_total bigint;
  v_done bigint;
  v_remaining bigint;
  v_percent int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select year_id into v_year from public.subjects where id = p_product_subject_id;
  if v_year is null then
    raise exception 'product_subject_not_found';
  end if;
  if not public.has_active_enrollment(v_year) then
    raise exception 'practice_access_denied';
  end if;
  if not public.has_practice_access(p_product_subject_id) then
    raise exception 'practice_access_denied';
  end if;

  select count(*) into v_total
  from public.questions q
  join public.mcq_bank_subfolders sf on sf.id = q.mcq_bank_subfolder_id
  join public.mcq_bank_folders f on f.id = sf.folder_id
  where f.academic_product_subject_id = p_product_subject_id
    and sf.deleted_at is null
    and f.deleted_at is null
    and q.status = 'approved'
    and q.deleted_at is null;

  select count(*) into v_done
  from public.questions q
  join public.mcq_bank_subfolders sf on sf.id = q.mcq_bank_subfolder_id
  join public.mcq_bank_folders f on f.id = sf.folder_id
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.state = 'done'
  where f.academic_product_subject_id = p_product_subject_id
    and sf.deleted_at is null
    and f.deleted_at is null
    and q.status = 'approved'
    and q.deleted_at is null;

  v_remaining := greatest(v_total - v_done, 0);
  if v_total <= 0 or v_done <= 0 then
    v_percent := 0;
  else
    v_percent := round((100.0 * least(v_done, v_total)) / v_total)::int;
  end if;

  return jsonb_build_object(
    'product_subject_id', p_product_subject_id,
    'total', v_total,
    'done', v_done,
    'remaining', v_remaining,
    'percent_complete', v_percent,
    'complete', (v_total > 0 and v_done >= v_total)
  );
end;
$$;

create or replace function public.reset_mcq_bank_subfolder_practice(p_subfolder_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reset int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not exists (
    select 1 from public.mcq_bank_subfolders sf
    where sf.id = p_subfolder_id and sf.deleted_at is null
  ) then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.can_access_mcq_bank_subfolder_practice(p_subfolder_id) then
    raise exception 'practice_access_denied';
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  update public.practice_progress pp
  set state = 'remaining',
      updated_at = now()
  where pp.student_id = v_uid
    and pp.item_kind = 'question'
    and pp.state = 'done'
    and exists (
      select 1
      from public.questions q
      where q.id = pp.item_id
        and q.mcq_bank_subfolder_id = p_subfolder_id
        and q.status = 'approved'
        and q.deleted_at is null
    );
  get diagnostics v_reset = row_count;
  perform set_config('medverse.practice_progress_rpc', '', true);

  return jsonb_build_object(
    'subfolder_id', p_subfolder_id,
    'reset_count', v_reset
  );
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

create or replace function public.reset_mcq_bank_folder_practice(p_folder_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reset int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not exists (
    select 1 from public.mcq_bank_folders f
    where f.id = p_folder_id and f.deleted_at is null
  ) then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.can_access_mcq_bank_folder_practice(p_folder_id) then
    raise exception 'practice_access_denied';
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  update public.practice_progress pp
  set state = 'remaining',
      updated_at = now()
  where pp.student_id = v_uid
    and pp.item_kind = 'question'
    and pp.state = 'done'
    and exists (
      select 1
      from public.questions q
      where q.id = pp.item_id
        and q.mcq_bank_folder_id = p_folder_id
        and q.mcq_bank_subfolder_id is not null
        and q.status = 'approved'
        and q.deleted_at is null
    );
  get diagnostics v_reset = row_count;
  perform set_config('medverse.practice_progress_rpc', '', true);

  return jsonb_build_object(
    'folder_id', p_folder_id,
    'reset_count', v_reset
  );
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

-- ===========================================================================
-- 8. get_practice_batch — subfolder scopes + folder aggregates (no legacy)
-- ===========================================================================
create or replace function public.get_practice_batch(
  p_scope_type text,
  p_scope_id uuid,
  p_limit int default 10
)
returns table (
  question_id uuid,
  question_version_id uuid,
  stem text,
  options jsonb,
  difficulty text,
  subject_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_subject_id uuid;
  v_day public.prof_session_days%rowtype;
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 100));
begin
  if p_scope_type in (
    'mcq_bank_subfolder',
    'mcq_bank_subfolder_favorites',
    'mcq_bank_subfolder_incorrect'
  ) then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated';
    end if;
    if not exists (
      select 1 from public.mcq_bank_subfolders sf
      where sf.id = p_scope_id and sf.deleted_at is null
    ) then
      raise exception 'mcq_bank_subfolder_not_found';
    end if;
    if not public.can_access_mcq_bank_subfolder_practice(p_scope_id) then
      raise exception 'practice_access_denied';
    end if;

    if p_scope_type = 'mcq_bank_subfolder_favorites' then
      return query
      with candidates as (
        select q.id, q.current_version_id, q.difficulty, q.subject_id
        from public.questions q
        join public.practice_progress pp
          on pp.item_id = q.id
         and pp.student_id = (select auth.uid())
         and pp.item_kind = 'question'
         and pp.marked = true
        where q.mcq_bank_subfolder_id = p_scope_id
          and q.status = 'approved'
          and q.deleted_at is null
      ),
      picked as (
        select c.id, c.current_version_id, c.difficulty, c.subject_id
        from candidates c
        left join public.practice_seen s
          on s.question_id = c.id and s.student_id = (select auth.uid())
        order by coalesce(s.cycle, 0) asc, random()
        limit greatest(1, least(p_limit, 50))
      ),
      marked_seen as (
        insert into public.practice_seen (student_id, question_id)
        select (select auth.uid()), p.id from picked p
        on conflict (student_id, question_id)
          do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
        returning question_id
      )
      select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
      from picked p
      join public.question_versions v on v.id = p.current_version_id
      join marked_seen m on m.question_id = p.id;
      return;
    end if;

    if p_scope_type = 'mcq_bank_subfolder_incorrect' then
      return query
      with candidates as (
        select q.id, q.current_version_id, q.difficulty, q.subject_id
        from public.questions q
        join public.practice_progress pp
          on pp.item_id = q.id
         and pp.student_id = (select auth.uid())
         and pp.item_kind = 'question'
         and pp.incorrect = true
        where q.mcq_bank_subfolder_id = p_scope_id
          and q.status = 'approved'
          and q.deleted_at is null
      ),
      picked as (
        select c.id, c.current_version_id, c.difficulty, c.subject_id
        from candidates c
        left join public.practice_seen s
          on s.question_id = c.id and s.student_id = (select auth.uid())
        order by coalesce(s.cycle, 0) asc, random()
        limit greatest(1, least(p_limit, 50))
      ),
      marked_seen as (
        insert into public.practice_seen (student_id, question_id)
        select (select auth.uid()), p.id from picked p
        on conflict (student_id, question_id)
          do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
        returning question_id
      )
      select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
      from picked p
      join public.question_versions v on v.id = p.current_version_id
      join marked_seen m on m.question_id = p.id;
      return;
    end if;

    return query
    with candidates as (
      select q.id, q.current_version_id, q.difficulty, q.subject_id
      from public.questions q
      left join public.practice_progress pp
        on pp.item_id = q.id
       and pp.student_id = (select auth.uid())
       and pp.item_kind = 'question'
      where q.mcq_bank_subfolder_id = p_scope_id
        and q.status = 'approved'
        and q.deleted_at is null
        and coalesce(pp.state, 'remaining') = 'remaining'
    ),
    picked as (
      select c.id, c.current_version_id, c.difficulty, c.subject_id
      from candidates c
      left join public.practice_seen s
        on s.question_id = c.id and s.student_id = (select auth.uid())
      order by coalesce(s.cycle, 0) asc, random()
      limit greatest(1, least(p_limit, 50))
    ),
    marked_seen as (
      insert into public.practice_seen (student_id, question_id)
      select (select auth.uid()), p.id from picked p
      on conflict (student_id, question_id)
        do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
      returning question_id
    )
    select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
    from picked p
    join public.question_versions v on v.id = p.current_version_id
    join marked_seen m on m.question_id = p.id;
    return;
  end if;

  if p_scope_type in (
    'mcq_bank_folder',
    'mcq_bank_folder_favorites',
    'mcq_bank_folder_incorrect'
  ) then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated';
    end if;
    if not exists (
      select 1 from public.mcq_bank_folders f
      where f.id = p_scope_id and f.deleted_at is null
    ) then
      raise exception 'mcq_bank_folder_not_found';
    end if;
    if not public.can_access_mcq_bank_folder_practice(p_scope_id) then
      raise exception 'practice_access_denied';
    end if;

    if p_scope_type = 'mcq_bank_folder_favorites' then
      return query
      with candidates as (
        select q.id, q.current_version_id, q.difficulty, q.subject_id
        from public.questions q
        join public.practice_progress pp
          on pp.item_id = q.id
         and pp.student_id = (select auth.uid())
         and pp.item_kind = 'question'
         and pp.marked = true
        where q.mcq_bank_folder_id = p_scope_id
          and q.mcq_bank_subfolder_id is not null
          and q.status = 'approved'
          and q.deleted_at is null
      ),
      picked as (
        select c.id, c.current_version_id, c.difficulty, c.subject_id
        from candidates c
        left join public.practice_seen s
          on s.question_id = c.id and s.student_id = (select auth.uid())
        order by coalesce(s.cycle, 0) asc, random()
        limit greatest(1, least(p_limit, 50))
      ),
      marked_seen as (
        insert into public.practice_seen (student_id, question_id)
        select (select auth.uid()), p.id from picked p
        on conflict (student_id, question_id)
          do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
        returning question_id
      )
      select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
      from picked p
      join public.question_versions v on v.id = p.current_version_id
      join marked_seen m on m.question_id = p.id;
      return;
    end if;

    if p_scope_type = 'mcq_bank_folder_incorrect' then
      return query
      with candidates as (
        select q.id, q.current_version_id, q.difficulty, q.subject_id
        from public.questions q
        join public.practice_progress pp
          on pp.item_id = q.id
         and pp.student_id = (select auth.uid())
         and pp.item_kind = 'question'
         and pp.incorrect = true
        where q.mcq_bank_folder_id = p_scope_id
          and q.mcq_bank_subfolder_id is not null
          and q.status = 'approved'
          and q.deleted_at is null
      ),
      picked as (
        select c.id, c.current_version_id, c.difficulty, c.subject_id
        from candidates c
        left join public.practice_seen s
          on s.question_id = c.id and s.student_id = (select auth.uid())
        order by coalesce(s.cycle, 0) asc, random()
        limit greatest(1, least(p_limit, 50))
      ),
      marked_seen as (
        insert into public.practice_seen (student_id, question_id)
        select (select auth.uid()), p.id from picked p
        on conflict (student_id, question_id)
          do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
        returning question_id
      )
      select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
      from picked p
      join public.question_versions v on v.id = p.current_version_id
      join marked_seen m on m.question_id = p.id;
      return;
    end if;

    return query
    with candidates as (
      select q.id, q.current_version_id, q.difficulty, q.subject_id
      from public.questions q
      left join public.practice_progress pp
        on pp.item_id = q.id
       and pp.student_id = (select auth.uid())
       and pp.item_kind = 'question'
      where q.mcq_bank_folder_id = p_scope_id
        and q.mcq_bank_subfolder_id is not null
        and q.status = 'approved'
        and q.deleted_at is null
        and coalesce(pp.state, 'remaining') = 'remaining'
    ),
    picked as (
      select c.id, c.current_version_id, c.difficulty, c.subject_id
      from candidates c
      left join public.practice_seen s
        on s.question_id = c.id and s.student_id = (select auth.uid())
      order by coalesce(s.cycle, 0) asc, random()
      limit greatest(1, least(p_limit, 50))
    ),
    marked_seen as (
      insert into public.practice_seen (student_id, question_id)
      select (select auth.uid()), p.id from picked p
      on conflict (student_id, question_id)
        do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
      returning question_id
    )
    select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
    from picked p
    join public.question_versions v on v.id = p.current_version_id
    join marked_seen m on m.question_id = p.id;
    return;
  end if;

  if p_scope_type = 'prof_session_day' then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated';
    end if;

    select * into v_day from public.prof_session_days where id = p_scope_id;
    if not found or v_day.deleted_at is not null then
      raise exception 'day_not_found';
    end if;
    if v_day.status is distinct from 'published' then
      raise exception 'day_not_published';
    end if;
    if v_day.subject_id is null then
      raise exception 'subject_id_required';
    end if;
    if not public.has_active_enrollment(v_day.year_id) then
      raise exception 'practice_access_denied';
    end if;
    if not public.has_live_subscription() then
      raise exception 'practice_access_denied';
    end if;

    return query
    with candidates as (
      select q.id, q.current_version_id, q.difficulty, q.subject_id, pq.sort_order
      from public.prof_session_day_practice_questions pq
      join public.questions q on q.id = pq.question_id
      where pq.day_id = p_scope_id
        and q.status = 'approved'
        and q.deleted_at is null
    ),
    picked as (
      select c.id, c.current_version_id, c.difficulty, c.subject_id, c.sort_order
      from candidates c
      left join public.practice_seen s
        on s.question_id = c.id and s.student_id = (select auth.uid())
      order by c.sort_order asc, coalesce(s.cycle, 0) asc, c.id
      limit v_limit
    ),
    marked_seen as (
      insert into public.practice_seen (student_id, question_id)
      select (select auth.uid()), p.id from picked p
      on conflict (student_id, question_id)
        do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
      returning question_id
    )
    select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
    from picked p
    join public.question_versions v on v.id = p.current_version_id
    join marked_seen m on m.question_id = p.id
    order by p.sort_order, p.id;
    return;
  end if;

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
    select q.id, q.current_version_id, q.difficulty, q.subject_id
    from public.questions q
    where q.status = 'approved'
      and q.deleted_at is null
      and case p_scope_type
        when 'subject' then q.subject_id = p_scope_id
        when 'book' then q.book_id = p_scope_id
        when 'chapter' then q.chapter_id = p_scope_id
        when 'topic' then q.topic_id = p_scope_id
      end
  ),
  picked as (
    select c.id, c.current_version_id, c.difficulty, c.subject_id
    from candidates c
    left join public.practice_seen s
      on s.question_id = c.id and s.student_id = (select auth.uid())
    order by coalesce(s.cycle, 0) asc, random()
    limit greatest(1, least(p_limit, 50))
  ),
  marked_seen as (
    insert into public.practice_seen (student_id, question_id)
    select (select auth.uid()), p.id from picked p
    on conflict (student_id, question_id)
      do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
    returning question_id
  )
  select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
  from picked p
  join public.question_versions v on v.id = p.current_version_id
  join marked_seen m on m.question_id = p.id;
end;
$$;

comment on function public.get_practice_batch(text, uuid, int) is
  'Practice batches: subject/book/chapter/topic, mcq_bank_subfolder(+favorites/incorrect), mcq_bank_folder aggregates(+favorites/incorrect; subfolder-attached only), prof_session_day. Favorites/Incorrect require can_access_* — not entitlement.';

-- ===========================================================================
-- 9. Content Bin — add mcq_bank_subfolder (extend soft/restore from folder pattern)
-- ===========================================================================
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
    when 'mcq_bank_folder' then
      perform public.admin_soft_delete_mcq_bank_folder(p_entity_id);
    when 'mcq_bank_subfolder' then
      perform public.admin_soft_delete_mcq_bank_subfolder(p_entity_id);
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
    when 'mcq_bank_folder' then
      if not public.has_permission('edit_questions') then
        raise exception 'permission_denied';
      end if;
      update public.mcq_bank_folders
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;
    when 'mcq_bank_subfolder' then
      if not public.has_permission('edit_questions') then
        raise exception 'permission_denied';
      end if;
      if not exists (
        select 1
        from public.mcq_bank_subfolders sf
        join public.mcq_bank_folders f on f.id = sf.folder_id
        where sf.id = p_entity_id
          and sf.deleted_at is not null
          and f.deleted_at is null
      ) then
        raise exception 'mcq_bank_subfolder_not_found';
      end if;
      update public.mcq_bank_subfolders
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;
    else
      raise exception 'unknown entity type: %', p_entity_type;
  end case;
end;
$$;

-- Patch purge_content: allow mcq_bank_subfolder (re-wrap latest body additions via CASE extension).
-- We only add the new branch by replacing the function from 20260925160000 shape + subfolder.
-- NOTE: keep permission split aligned with question/folder.

-- Minimal additive: create helper used by list + purge path
-- For purge, delegate hard delete when soft-deleted.

create or replace function public.purge_mcq_bank_subfolder_content(p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_name text;
begin
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  select year_id, name into v_year_id, v_name
  from public.mcq_bank_subfolders
  where id = p_entity_id and deleted_at is not null;
  if v_year_id is null then
    raise exception 'entity_not_found';
  end if;
  if not public.admin_can_access_year(v_year_id) then
    raise exception 'year_scope_denied';
  end if;
  if exists (
    select 1 from public.questions q
    where q.mcq_bank_subfolder_id = p_entity_id
  ) then
    -- FK ON DELETE SET NULL, but refuse if live questions still point here
    if exists (
      select 1 from public.questions q
      where q.mcq_bank_subfolder_id = p_entity_id and q.deleted_at is null
    ) then
      raise exception 'subfolder_not_empty';
    end if;
  end if;
  delete from public.mcq_bank_subfolders where id = p_entity_id and deleted_at is not null;
  perform public.log_audit(
    'content_purged',
    'mcq_bank_subfolder',
    p_entity_id,
    jsonb_build_object('name', v_name, 'year_id', v_year_id)
  );
end;
$$;

-- Extend list_content_bin with subfolder rows via wrapper view-style union in a thin RPC overlay.
-- Re-create list by selecting previous logic is heavy; add companion RPC used by UI if needed.
-- Instead: patch list_content_bin from 24180000 + one_liner + mcq folder + subfolder.

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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'admin_only';
  end if;
  if not (
    public.has_permission('manage_materials')
    or public.has_permission('edit_questions')
  ) then
    raise exception 'permission_denied';
  end if;
  if p_year_id is not null and not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  return query
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
    select 'pearl_point'::text, pp.id, left(pp.prompt, 200), pp.year_id, pp.deleted_at, pp.purge_after, pp.deleted_by, false
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
    select 'question'::text, q.id, coalesce(q.stem_normalized, q.id::text), q.year_id, q.deleted_at, q.purge_after, q.deleted_by, false
    from public.questions q
    where q.deleted_at is not null
      and (p_year_id is null or q.year_id = p_year_id)
      and public.admin_can_access_year(q.year_id)
    union all
    select 'prof_session_day'::text, d.id, d.name, d.year_id, d.deleted_at, d.purge_after, d.deleted_by, false
    from public.prof_session_days d
    where d.deleted_at is not null
      and (p_year_id is null or d.year_id = p_year_id)
      and public.admin_can_access_year(d.year_id)
    union all
    select 'one_liner'::text, ol.id, left(ol.title, 200), ol.year_id, ol.deleted_at, ol.purge_after, ol.deleted_by, false
    from public.one_liners ol
    where ol.deleted_at is not null
      and (p_year_id is null or ol.year_id = p_year_id)
      and public.admin_can_access_year(ol.year_id)
    union all
    select 'mcq_bank_folder'::text, mbf.id, mbf.name, mbf.year_id, mbf.deleted_at, mbf.purge_after, mbf.deleted_by, false
    from public.mcq_bank_folders mbf
    where mbf.deleted_at is not null
      and (p_year_id is null or mbf.year_id = p_year_id)
      and public.admin_can_access_year(mbf.year_id)
    union all
    select 'mcq_bank_subfolder'::text, s.id, s.name, s.year_id, s.deleted_at, s.purge_after, s.deleted_by, false
    from public.mcq_bank_subfolders s
    where s.deleted_at is not null
      and (p_year_id is null or s.year_id = p_year_id)
      and public.admin_can_access_year(s.year_id)
  order by 5 desc;
end;
$$;

-- ===========================================================================
-- 10. EXECUTE seals
-- ===========================================================================
revoke execute on function public.admin_create_mcq_bank_subfolder(uuid, text) from public, anon;
grant execute on function public.admin_create_mcq_bank_subfolder(uuid, text) to authenticated, service_role;
revoke execute on function public.admin_rename_mcq_bank_subfolder(uuid, text) from public, anon;
grant execute on function public.admin_rename_mcq_bank_subfolder(uuid, text) to authenticated, service_role;
revoke execute on function public.admin_reorder_mcq_bank_subfolders(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_mcq_bank_subfolders(uuid, uuid[]) to authenticated, service_role;
revoke execute on function public.admin_soft_delete_mcq_bank_subfolder(uuid) from public, anon;
grant execute on function public.admin_soft_delete_mcq_bank_subfolder(uuid) to authenticated, service_role;
revoke execute on function public.admin_list_mcq_bank_subfolders(uuid) from public, anon;
grant execute on function public.admin_list_mcq_bank_subfolders(uuid) to authenticated, service_role;
revoke execute on function public.admin_list_subfolder_questions(uuid, int, int) from public, anon;
grant execute on function public.admin_list_subfolder_questions(uuid, int, int) to authenticated, service_role;
revoke execute on function public.admin_list_mcq_bank_folders(uuid) from public, anon;
grant execute on function public.admin_list_mcq_bank_folders(uuid) to authenticated, service_role;
revoke execute on function public.admin_soft_delete_mcq_bank_folder(uuid) from public, anon;
grant execute on function public.admin_soft_delete_mcq_bank_folder(uuid) to authenticated, service_role;

revoke execute on function public.admin_assign_unassigned_question_to_subfolder(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_unassigned_question_to_subfolder(uuid, uuid) to authenticated, service_role;
revoke execute on function public.admin_remove_question_from_mcq_bank_subfolder(uuid) from public, anon;
grant execute on function public.admin_remove_question_from_mcq_bank_subfolder(uuid) to authenticated, service_role;
revoke execute on function public.admin_bulk_move_mcq_bank_subfolder_questions(uuid, uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_bulk_move_mcq_bank_subfolder_questions(uuid, uuid, uuid[], boolean) to authenticated, service_role;
revoke execute on function public.admin_bulk_remove_questions_from_mcq_bank_subfolder(uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_bulk_remove_questions_from_mcq_bank_subfolder(uuid, uuid[], boolean) to authenticated, service_role;
revoke execute on function public.admin_bulk_soft_delete_subfolder_questions(uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_bulk_soft_delete_subfolder_questions(uuid, uuid[], boolean) to authenticated, service_role;

revoke execute on function public.can_access_mcq_bank_subfolder_practice(uuid) from public, anon;
grant execute on function public.can_access_mcq_bank_subfolder_practice(uuid) to authenticated, service_role;
revoke execute on function public.get_mcq_bank_subfolder_practice_progress(uuid) from public, anon;
grant execute on function public.get_mcq_bank_subfolder_practice_progress(uuid) to authenticated, service_role;
revoke execute on function public.list_mcq_bank_subfolder_practice_progress(uuid) from public, anon;
grant execute on function public.list_mcq_bank_subfolder_practice_progress(uuid) to authenticated, service_role;
revoke execute on function public.get_mcq_bank_product_practice_progress(uuid) from public, anon;
grant execute on function public.get_mcq_bank_product_practice_progress(uuid) to authenticated, service_role;
revoke execute on function public.reset_mcq_bank_subfolder_practice(uuid) from public, anon;
grant execute on function public.reset_mcq_bank_subfolder_practice(uuid) to authenticated, service_role;
revoke execute on function public.get_mcq_bank_folder_practice_progress(uuid) from public, anon;
grant execute on function public.get_mcq_bank_folder_practice_progress(uuid) to authenticated, service_role;
revoke execute on function public.list_mcq_bank_folder_practice_progress(uuid) from public, anon;
grant execute on function public.list_mcq_bank_folder_practice_progress(uuid) to authenticated, service_role;
revoke execute on function public.reset_mcq_bank_folder_practice(uuid) from public, anon;
grant execute on function public.reset_mcq_bank_folder_practice(uuid) to authenticated, service_role;
revoke execute on function public.get_practice_batch(text, uuid, int) from public, anon;
grant execute on function public.get_practice_batch(text, uuid, int) to authenticated, service_role;

revoke execute on function public.import_question_batch(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_question_batch(uuid, jsonb, boolean, uuid) to authenticated, service_role;
revoke execute on function public.create_question(uuid, text, jsonb, char, text, text, text, text[], text, uuid) from public, anon;
grant execute on function public.create_question(uuid, text, jsonb, char, text, text, text, text[], text, uuid) to authenticated, service_role;

revoke execute on function public.soft_delete_content(text, uuid) from public, anon;
grant execute on function public.soft_delete_content(text, uuid) to authenticated, service_role;
revoke execute on function public.restore_content(text, uuid) from public, anon;
grant execute on function public.restore_content(text, uuid) to authenticated, service_role;
revoke execute on function public.list_content_bin(uuid) from public, anon;
grant execute on function public.list_content_bin(uuid) to authenticated, service_role;
revoke execute on function public.purge_mcq_bank_subfolder_content(uuid) from public, anon;
grant execute on function public.purge_mcq_bank_subfolder_content(uuid) to authenticated, service_role;

comment on function public.admin_create_mcq_bank_subfolder(uuid, text) is
  'Create MCQ Bank subfolder under a live folder. edit_questions + admin_can_access_year.';
comment on function public.can_access_mcq_bank_subfolder_practice(uuid) is
  'Subfolder practice gate via parent folder can_access_mcq_bank_folder_practice. Favorites/Incorrect are not entitlement.';
