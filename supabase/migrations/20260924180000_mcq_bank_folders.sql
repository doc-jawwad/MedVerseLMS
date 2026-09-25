-- Academic MCQ Bank folders: admin-managed placement under product Blocks / FY subjects.
-- Question Bank taxonomy (departmental subject_id) unchanged.
-- Legacy questions stay mcq_bank_folder_id NULL; seed Source folders only.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.mcq_bank_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
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
  constraint mcq_bank_folders_name_nonempty check (length(trim(name)) > 0)
);

comment on table public.mcq_bank_folders is
  'Academic MCQ Bank folders under product Block / Final Year subjects. Not nested. Not Q-bank taxonomy.';

create index if not exists mcq_bank_folders_product_sort_idx
  on public.mcq_bank_folders (academic_product_subject_id, sort_order)
  where deleted_at is null;

create index if not exists mcq_bank_folders_year_idx
  on public.mcq_bank_folders (year_id)
  where deleted_at is null;

create index if not exists mcq_bank_folders_deleted_at_idx
  on public.mcq_bank_folders (deleted_at)
  where deleted_at is not null;

drop trigger if exists mcq_bank_folders_set_updated_at on public.mcq_bank_folders;
create trigger mcq_bank_folders_set_updated_at
  before update on public.mcq_bank_folders
  for each row execute function public.set_updated_at();

create or replace function public.protect_mcq_bank_folder_product_subject()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_year uuid;
begin
  select product_key, year_id into v_key, v_year
  from public.subjects
  where id = new.academic_product_subject_id;

  if not found then
    raise exception 'product_subject_not_found';
  end if;
  if v_key is null then
    raise exception 'academic_product_subject_required';
  end if;

  new.year_id := v_year;
  return new;
end;
$$;

drop trigger if exists trg_protect_mcq_bank_folder_product_subject on public.mcq_bank_folders;
create trigger trg_protect_mcq_bank_folder_product_subject
  before insert or update of academic_product_subject_id
  on public.mcq_bank_folders
  for each row execute function public.protect_mcq_bank_folder_product_subject();

-- ---------------------------------------------------------------------------
-- 2. questions.mcq_bank_folder_id
-- ---------------------------------------------------------------------------
alter table public.questions
  add column if not exists mcq_bank_folder_id uuid
    references public.mcq_bank_folders (id)
    on delete set null;

comment on column public.questions.mcq_bank_folder_id is
  'Academic MCQ Bank folder ownership (0 or 1). NULL = unassigned. Independent of Q-bank subject_id and Prof. Session / test junctions.';

create index if not exists questions_mcq_bank_folder_idx
  on public.questions (mcq_bank_folder_id)
  where mcq_bank_folder_id is not null and deleted_at is null;

create or replace function public.protect_question_mcq_bank_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
begin
  -- Block cross-folder move via raw UPDATE (folder A → folder B).
  if tg_op = 'UPDATE'
     and old.mcq_bank_folder_id is not null
     and new.mcq_bank_folder_id is not null
     and old.mcq_bank_folder_id is distinct from new.mcq_bank_folder_id then
    raise exception 'mcq_bank_folder_reassign_forbidden';
  end if;

  if new.mcq_bank_folder_id is null then
    return new;
  end if;

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
end;
$$;

drop trigger if exists trg_protect_question_mcq_bank_folder on public.questions;
create trigger trg_protect_question_mcq_bank_folder
  before insert or update of mcq_bank_folder_id, year_id
  on public.questions
  for each row execute function public.protect_question_mcq_bank_folder();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.mcq_bank_folders enable row level security;

drop policy if exists mcq_bank_folders_admin_select on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_select on public.mcq_bank_folders
  for select using (public.is_admin());

drop policy if exists mcq_bank_folders_admin_insert on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_insert on public.mcq_bank_folders
  for insert with check (public.has_permission('edit_questions'));

drop policy if exists mcq_bank_folders_admin_update on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_update on public.mcq_bank_folders
  for update using (public.has_permission('edit_questions'))
  with check (public.has_permission('edit_questions'));

drop policy if exists mcq_bank_folders_admin_delete on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_delete on public.mcq_bank_folders
  for delete using (public.has_permission('edit_questions'));

drop policy if exists mcq_bank_folders_student_select on public.mcq_bank_folders;
create policy mcq_bank_folders_student_select on public.mcq_bank_folders
  for select using (
    deleted_at is null
    and public.account_allows_lms()
    and public.has_active_enrollment(year_id)
  );

grant select on public.mcq_bank_folders to authenticated;
grant insert, update, delete on public.mcq_bank_folders to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Seed Source MCQ Folder per product subject (no question remapping)
-- ---------------------------------------------------------------------------
insert into public.mcq_bank_folders (
  academic_product_subject_id, year_id, name, sort_order, created_by
)
select
  s.id,
  s.year_id,
  'Source MCQ Folder',
  0,
  null
from public.subjects s
where s.product_key is not null
  and not exists (
    select 1
    from public.mcq_bank_folders f
    where f.academic_product_subject_id = s.id
      and f.deleted_at is null
      and f.name = 'Source MCQ Folder'
  );

-- ---------------------------------------------------------------------------
-- 5. Admin folder RPCs
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
  perform public.log_audit(
    'mcq_bank_folder_renamed',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object('name', v_name)
  );
end;
$$;

create or replace function public.admin_reorder_mcq_bank_folders(
  p_product_subject_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year uuid;
  v_key text;
  v_id uuid;
  v_i int;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;

  select year_id, product_key into v_year, v_key
  from public.subjects where id = p_product_subject_id;
  if not found or v_key is null then
    raise exception 'academic_product_subject_required';
  end if;
  if not public.admin_can_access_year(v_year) then
    raise exception 'year_scope_denied';
  end if;

  if p_ordered_ids is null or cardinality(p_ordered_ids) = 0 then
    return;
  end if;

  v_i := 0;
  foreach v_id in array p_ordered_ids
  loop
    update public.mcq_bank_folders
    set sort_order = v_i
    where id = v_id
      and academic_product_subject_id = p_product_subject_id
      and deleted_at is null;
    v_i := v_i + 1;
  end loop;
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

  update public.mcq_bank_folders
  set
    deleted_at = now(),
    purge_after = now() + interval '7 days',
    deleted_by = (select auth.uid())
  where id = p_folder_id;

  perform public.log_audit(
    'mcq_bank_folder_soft_deleted',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object('name', v_row.name)
  );
end;
$$;

create or replace function public.admin_list_mcq_bank_folders(p_product_subject_id uuid)
returns table (
  folder_id uuid,
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
    f.created_at
  from public.mcq_bank_folders f
  where f.academic_product_subject_id = p_product_subject_id
    and f.deleted_at is null
  order by f.sort_order, f.name, f.id;
end;
$$;

create or replace function public.admin_list_folder_questions(
  p_folder_id uuid,
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
  v_row public.mcq_bank_folders%rowtype;
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

  select * into v_row from public.mcq_bank_folders where id = p_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  select count(*) into v_total
  from public.questions q
  where q.mcq_bank_folder_id = p_folder_id
    and q.deleted_at is null;

  return query
  select
    q.id,
    q.status,
    q.difficulty,
    left(coalesce(qv.stem, ''), 160),
    s.name,
    t.name,
    q.created_at,
    v_total
  from public.questions q
  left join public.question_versions qv on qv.id = q.current_version_id
  left join public.subjects s on s.id = q.subject_id
  left join public.topics t on t.id = q.topic_id
  where q.mcq_bank_folder_id = p_folder_id
    and q.deleted_at is null
  order by q.created_at desc, q.id
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_remove_question_from_mcq_bank_folder(p_question_id uuid)
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
  if not public.admin_can_access_year(v_q.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.questions
  set mcq_bank_folder_id = null
  where id = p_question_id;

  perform public.log_audit(
    'mcq_removed_from_folder',
    'question',
    p_question_id,
    jsonb_build_object('from_folder_id', v_q.mcq_bank_folder_id)
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
declare
  v_q public.questions%rowtype;
  v_f public.mcq_bank_folders%rowtype;
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
  if v_q.mcq_bank_folder_id is not null then
    raise exception 'already_in_mcq_bank_folder';
  end if;
  if not public.admin_can_access_year(v_q.year_id) then
    raise exception 'year_scope_denied';
  end if;

  select * into v_f from public.mcq_bank_folders where id = p_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if v_f.year_id is distinct from v_q.year_id then
    raise exception 'mcq_bank_folder_year_mismatch';
  end if;
  if not public.admin_can_access_year(v_f.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.questions
  set mcq_bank_folder_id = p_folder_id
  where id = p_question_id
    and mcq_bank_folder_id is null;

  if not found then
    raise exception 'already_in_mcq_bank_folder';
  end if;

  perform public.log_audit(
    'mcq_assigned_to_folder',
    'question',
    p_question_id,
    jsonb_build_object('folder_id', p_folder_id)
  );
end;
$$;

create or replace function public.admin_list_unassigned_questions(
  p_year_id uuid,
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
  if not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  select count(*) into v_total
  from public.questions q
  where q.year_id = p_year_id
    and q.mcq_bank_folder_id is null
    and q.deleted_at is null;

  return query
  select
    q.id,
    q.status,
    q.difficulty,
    left(coalesce(qv.stem, ''), 160),
    s.name,
    t.name,
    q.created_at,
    v_total
  from public.questions q
  left join public.question_versions qv on qv.id = q.current_version_id
  left join public.subjects s on s.id = q.subject_id
  left join public.topics t on t.id = q.topic_id
  where q.year_id = p_year_id
    and q.mcq_bank_folder_id is null
    and q.deleted_at is null
  order by q.created_at desc, q.id
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.list_question_usages(p_question_id uuid)
returns table (
  usage_kind text,
  usage_label text,
  ref_id uuid
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

  select year_id into v_year from public.questions where id = p_question_id;
  if v_year is null then
    raise exception 'question_not_found';
  end if;
  if not public.admin_can_access_year(v_year) then
    raise exception 'year_scope_denied';
  end if;

  return query
  select u.usage_kind, u.usage_label, u.ref_id
  from (
    select
      'academic_mcq_folder'::text as usage_kind,
      ('Academic MCQ Bank → ' || coalesce(ps.name, '?') || ' → ' || coalesce(f.name, '?'))::text as usage_label,
      f.id as ref_id
    from public.questions q
    join public.mcq_bank_folders f on f.id = q.mcq_bank_folder_id and f.deleted_at is null
    join public.subjects ps on ps.id = f.academic_product_subject_id
    where q.id = p_question_id
      and q.mcq_bank_folder_id is not null

    union all

    select
      'prof_session_day'::text,
      ('Prof. Session → ' || coalesce(d.name, '?'))::text,
      d.id
    from public.prof_session_day_practice_questions pq
    join public.prof_session_days d on d.id = pq.day_id and d.deleted_at is null
    where pq.question_id = p_question_id

    union all

    select
      case when t.test_type = 'mock' then 'mock_test' else 'formal_test' end,
      (
        case when t.test_type = 'mock' then 'Mock Test → ' else 'Formal Test → ' end
        || coalesce(t.title, '?')
      )::text,
      t.id
    from public.test_questions tq
    join public.tests t on t.id = tq.test_id
    where tq.question_id = p_question_id
  ) u
  order by u.usage_kind, u.usage_label;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Extend create_question with optional folder ownership
-- ---------------------------------------------------------------------------
drop function if exists public.create_question(
  uuid, text, jsonb, char, text, text, text, text[], text
);

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

-- ---------------------------------------------------------------------------
-- 7. get_practice_batch — mcq_bank_folder scope
-- ---------------------------------------------------------------------------
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
  difficulty text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_subject_id uuid;
  v_day public.prof_session_days%rowtype;
  v_folder public.mcq_bank_folders%rowtype;
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 100));
begin
  if p_scope_type = 'mcq_bank_folder' then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated';
    end if;

    select * into v_folder
    from public.mcq_bank_folders
    where id = p_scope_id and deleted_at is null;
    if not found then
      raise exception 'mcq_bank_folder_not_found';
    end if;
    if not public.has_active_enrollment(v_folder.year_id) then
      raise exception 'practice_access_denied';
    end if;
    if not public.has_practice_access(v_folder.academic_product_subject_id) then
      raise exception 'practice_access_denied';
    end if;

    return query
    with candidates as (
      select q.id, q.current_version_id, q.difficulty
      from public.questions q
      where q.mcq_bank_folder_id = p_scope_id
        and q.status = 'approved'
        and q.deleted_at is null
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
      select q.id, q.current_version_id, q.difficulty, pq.sort_order
      from public.prof_session_day_practice_questions pq
      join public.questions q on q.id = pq.question_id
      where pq.day_id = p_scope_id
        and q.status = 'approved'
        and q.deleted_at is null
    ),
    picked as (
      select c.id, c.current_version_id, c.difficulty, c.sort_order
      from candidates c
      left join public.practice_seen s
        on s.question_id = c.id and s.student_id = (select auth.uid())
      order by c.sort_order asc, coalesce(s.cycle, 0) asc, c.id
      limit v_limit
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
    join marked m on m.question_id = p.id
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
    select q.id, q.current_version_id, q.difficulty
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

comment on function public.get_practice_batch(text, uuid, int) is
  'Practice batches by subject/book/chapter/topic, mcq_bank_folder (product subject entitlement), or prof_session_day.';

-- ---------------------------------------------------------------------------
-- 8. Content Bin — mcq_bank_folder entity
-- ---------------------------------------------------------------------------
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
      if not public.has_permission('edit_questions') then
        raise exception 'permission_denied';
      end if;
      if exists (
        select 1 from public.questions q
        where q.mcq_bank_folder_id = p_entity_id
          and q.deleted_at is null
      ) then
        raise exception 'folder_not_empty';
      end if;
      update public.mcq_bank_folders
      set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = auth.uid()
      where id = p_entity_id and deleted_at is null;
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
declare
  v_year_id uuid;
  v_name text;
  v_r2 text;
  v_cover text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day', 'one_liner', 'mcq_bank_folder'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type in ('question', 'mcq_bank_folder') then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
  else
    if not public.has_permission('manage_materials') then
      raise exception 'permission_denied';
    end if;
  end if;

  case p_entity_type
    when 'material_folder' then
      select year_id, name into v_year_id, v_name
      from public.material_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      for v_r2, v_cover in
        select m.r2_object_key, m.cover_object_key
        from public.materials m where m.folder_id = p_entity_id
      loop
        perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
        perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      end loop;
      delete from public.material_folders where id = p_entity_id;

    when 'material' then
      select f.year_id, m.title, m.r2_object_key, m.cover_object_key
        into v_year_id, v_name, v_r2, v_cover
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
      perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      delete from public.materials where id = p_entity_id;

    when 'pearl_point' then
      select year_id, left(prompt, 200) into v_year_id, v_name
      from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.pearl_points where id = p_entity_id;

    when 'ospe_station' then
      select year_id, title, r2_object_key into v_year_id, v_name, v_r2
      from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      perform public.enqueue_r2_purge(v_r2, 'ospe_station', p_entity_id);
      delete from public.ospe_stations where id = p_entity_id;

    when 'question' then
      select year_id, coalesce(stem_normalized, id::text) into v_year_id, v_name
      from public.questions where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      if exists (select 1 from public.test_questions where question_id = p_entity_id) then
        raise exception 'question_referenced_by_test';
      end if;
      delete from public.questions where id = p_entity_id;

    when 'prof_session_day' then
      select year_id, name into v_year_id, v_name
      from public.prof_session_days where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.prof_session_days where id = p_entity_id;

    when 'one_liner' then
      select year_id, left(title, 200) into v_year_id, v_name
      from public.one_liners where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.one_liners where id = p_entity_id and deleted_at is not null;

    when 'mcq_bank_folder' then
      select year_id, name into v_year_id, v_name
      from public.mcq_bank_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      -- ON DELETE SET NULL clears question placements
      delete from public.mcq_bank_folders where id = p_entity_id and deleted_at is not null;
  end case;

  perform public.log_audit(
    'content_purged',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('name', v_name, 'year_id', v_year_id)
  );
end;
$$;

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
    select 'one_liner'::text, ol.id, left(ol.title, 80), ol.year_id, ol.deleted_at, ol.purge_after, ol.deleted_by, false
    from public.one_liners ol
    where ol.deleted_at is not null
      and (p_year_id is null or ol.year_id = p_year_id)
      and public.admin_can_access_year(ol.year_id)
    union all
    select 'mcq_bank_folder'::text, mbf.id, mbf.name, mbf.year_id, mbf.deleted_at, mbf.purge_after, mbf.deleted_by, false
    from public.mcq_bank_folders mbf
    where mbf.deleted_at is not null
      and (p_year_id is null or mbf.year_id = p_year_id)
      and public.admin_can_access_year(mbf.year_id);
end;
$$;

-- Grants
revoke execute on function public.admin_create_mcq_bank_folder(uuid, text) from public, anon;
grant execute on function public.admin_create_mcq_bank_folder(uuid, text) to authenticated, service_role;
revoke execute on function public.admin_rename_mcq_bank_folder(uuid, text) from public, anon;
grant execute on function public.admin_rename_mcq_bank_folder(uuid, text) to authenticated, service_role;
revoke execute on function public.admin_reorder_mcq_bank_folders(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_mcq_bank_folders(uuid, uuid[]) to authenticated, service_role;
revoke execute on function public.admin_soft_delete_mcq_bank_folder(uuid) from public, anon;
grant execute on function public.admin_soft_delete_mcq_bank_folder(uuid) to authenticated, service_role;
revoke execute on function public.admin_list_mcq_bank_folders(uuid) from public, anon;
grant execute on function public.admin_list_mcq_bank_folders(uuid) to authenticated, service_role;
revoke execute on function public.admin_list_folder_questions(uuid, int, int) from public, anon;
grant execute on function public.admin_list_folder_questions(uuid, int, int) to authenticated, service_role;
revoke execute on function public.admin_remove_question_from_mcq_bank_folder(uuid) from public, anon;
grant execute on function public.admin_remove_question_from_mcq_bank_folder(uuid) to authenticated, service_role;
revoke execute on function public.admin_assign_unassigned_question_to_folder(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_unassigned_question_to_folder(uuid, uuid) to authenticated, service_role;
revoke execute on function public.admin_list_unassigned_questions(uuid, int, int) from public, anon;
grant execute on function public.admin_list_unassigned_questions(uuid, int, int) to authenticated, service_role;
revoke execute on function public.list_question_usages(uuid) from public, anon;
grant execute on function public.list_question_usages(uuid) to authenticated, service_role;

revoke execute on function public.create_question(
  uuid, text, jsonb, char, text, text, text, text[], text, uuid
) from public, anon;
grant execute on function public.create_question(
  uuid, text, jsonb, char, text, text, text, text[], text, uuid
) to authenticated, service_role;

revoke execute on function public.soft_delete_content(text, uuid) from public, anon;
grant execute on function public.soft_delete_content(text, uuid) to authenticated, service_role;
revoke execute on function public.restore_content(text, uuid) from public, anon;
grant execute on function public.restore_content(text, uuid) to authenticated, service_role;
revoke execute on function public.purge_content(text, uuid) from public, anon;
grant execute on function public.purge_content(text, uuid) to authenticated, service_role;
revoke execute on function public.list_content_bin(uuid) from public, anon;
grant execute on function public.list_content_bin(uuid) to authenticated, service_role;
