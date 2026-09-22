-- 20260922000005: Prof. Session subject-scoped IA
-- Days belong to product Blocks / Final-Year subjects.
-- Day slots: guidelines, los, one_liners, practice_mcqs, test_mcq (syllabus removed).
-- Block-level PS materials via content_surface + new library_types.
-- Day attachments: folder day FKs, one_liners.day, tests.day, practice question junction.
-- Safe on empty staging (0 days). Live year-level days without subject → soft-deleted to Bin
-- (do not invent Block parents). Docs: architecture.md §2c, database.md Prof. Session.

-- ---------------------------------------------------------------------------
-- 1. material_folders: surface + day attach + library_type expand
-- ---------------------------------------------------------------------------

alter table public.material_folders
  add column if not exists content_surface text not null default 'academic';

alter table public.material_folders
  drop constraint if exists material_folders_content_surface_check;

alter table public.material_folders
  add constraint material_folders_content_surface_check
  check (content_surface in ('academic', 'prof_session'));

alter table public.material_folders
  add column if not exists prof_session_day_id uuid
    references public.prof_session_days (id) on delete cascade;

alter table public.material_folders
  add column if not exists day_slot_key text;

alter table public.material_folders
  drop constraint if exists material_folders_day_slot_pair_chk;

alter table public.material_folders
  add constraint material_folders_day_slot_pair_chk
  check (
    (prof_session_day_id is null and day_slot_key is null)
    or (
      prof_session_day_id is not null
      and day_slot_key in ('guidelines', 'los')
      and content_surface = 'prof_session'
    )
  );

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
    'flashcards'
  ));

alter table public.material_folders
  drop constraint if exists material_folders_day_slot_type_chk;

alter table public.material_folders
  add constraint material_folders_day_slot_type_chk
  check (
    prof_session_day_id is null
    or (day_slot_key = 'guidelines' and library_type = 'guidelines')
    or (day_slot_key = 'los' and library_type = 'los')
  );

create index if not exists material_folders_surface_subject_idx
  on public.material_folders (content_surface, subject_id)
  where deleted_at is null;

create index if not exists material_folders_day_slot_idx
  on public.material_folders (prof_session_day_id, day_slot_key)
  where prof_session_day_id is not null and deleted_at is null;

comment on column public.material_folders.content_surface is
  'academic = Academic Block chrome; prof_session = Prof. Session Block chrome. Same materials engine.';
comment on column public.material_folders.prof_session_day_id is
  'When set, folder is day-scoped Guidelines/LoS under Prof. Session MCQ Bank.';

-- ---------------------------------------------------------------------------
-- 2. prof_session_days.subject_id + orphan soft-delete
-- ---------------------------------------------------------------------------

alter table public.prof_session_days
  add column if not exists subject_id uuid
    references public.subjects (id) on delete cascade;

-- Preserve year-level live days: soft-delete into Bin; do not invent subject parents.
update public.prof_session_days
set
  deleted_at = coalesce(deleted_at, now()),
  purge_after = coalesce(purge_after, now() + interval '7 days'),
  deleted_by = coalesce(deleted_by, null),
  updated_at = now()
where subject_id is null
  and deleted_at is null;

alter table public.prof_session_days
  drop constraint if exists prof_session_days_subject_required_live;

alter table public.prof_session_days
  add constraint prof_session_days_subject_required_live
  check (deleted_at is not null or subject_id is not null);

create or replace function public.prof_session_days_sync_year_from_subject()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year uuid;
  v_key text;
begin
  if new.subject_id is null then
    if new.deleted_at is null then
      raise exception 'subject_id_required';
    end if;
    return new;
  end if;

  select s.year_id, s.product_key into v_year, v_key
  from public.subjects s
  where s.id = new.subject_id;

  if v_year is null then
    raise exception 'invalid_subject';
  end if;
  if v_key is null or btrim(v_key) = '' then
    raise exception 'subject_not_product_block';
  end if;

  new.year_id := v_year;
  return new;
end;
$$;

drop trigger if exists prof_session_days_sync_year on public.prof_session_days;
create trigger prof_session_days_sync_year
  before insert or update of subject_id, deleted_at
  on public.prof_session_days
  for each row execute function public.prof_session_days_sync_year_from_subject();

drop index if exists public.prof_session_days_year_name_uidx;

create unique index if not exists prof_session_days_subject_name_uidx
  on public.prof_session_days (subject_id, lower(name))
  where deleted_at is null and subject_id is not null;

create index if not exists prof_session_days_subject_idx
  on public.prof_session_days (subject_id)
  where deleted_at is null;

comment on column public.prof_session_days.subject_id is
  'Product Block / Final-Year subject. Required for live days. year_id is derived from subject.';

-- ---------------------------------------------------------------------------
-- 3. Day slots: drop syllabus, add los, tighten CHECK
-- ---------------------------------------------------------------------------

delete from public.prof_session_day_slots where slot_key = 'syllabus';

insert into public.prof_session_day_slots (day_id, slot_key)
select d.id, 'los'
from public.prof_session_days d
where not exists (
  select 1 from public.prof_session_day_slots s
  where s.day_id = d.id and s.slot_key = 'los'
);

alter table public.prof_session_day_slots
  drop constraint if exists prof_session_day_slots_slot_key_check;

alter table public.prof_session_day_slots
  add constraint prof_session_day_slots_slot_key_check
  check (slot_key in (
    'guidelines', 'los', 'one_liners', 'practice_mcqs', 'test_mcq'
  ));

comment on table public.prof_session_day_slots is
  'Fixed Prof. Session day chrome: guidelines, los, one_liners, practice_mcqs, test_mcq.';

-- ---------------------------------------------------------------------------
-- 4. one_liners + tests day FK
-- ---------------------------------------------------------------------------

alter table public.one_liners
  add column if not exists prof_session_day_id uuid
    references public.prof_session_days (id) on delete set null;

create index if not exists one_liners_day_idx
  on public.one_liners (prof_session_day_id)
  where deleted_at is null and prof_session_day_id is not null;

comment on column public.one_liners.prof_session_day_id is
  'When set, one-liner belongs to a Prof. Session Day (not Pearl Points).';

alter table public.tests
  add column if not exists prof_session_day_id uuid
    references public.prof_session_days (id) on delete set null;

create index if not exists tests_prof_session_day_idx
  on public.tests (prof_session_day_id)
  where prof_session_day_id is not null;

comment on column public.tests.prof_session_day_id is
  'Optional link: formal Test MCQ pool for a Prof. Session Day.';

-- ---------------------------------------------------------------------------
-- 5. Practice MCQ junction (reuse questions; no duplicates)
-- ---------------------------------------------------------------------------

create table if not exists public.prof_session_day_practice_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  day_id uuid not null references public.prof_session_days (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (day_id, question_id)
);

create index if not exists prof_session_day_practice_questions_day_idx
  on public.prof_session_day_practice_questions (day_id, sort_order);

comment on table public.prof_session_day_practice_questions is
  'Curated Practice MCQ set for a Prof. Session Day. References existing questions.';

alter table public.prof_session_day_practice_questions enable row level security;

drop policy if exists ps_day_practice_q_admin_all on public.prof_session_day_practice_questions;
create policy ps_day_practice_q_admin_all on public.prof_session_day_practice_questions
  for all using (
    public.has_permission('manage_materials')
    and exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and public.admin_can_access_year(d.year_id)
    )
  )
  with check (
    public.has_permission('manage_materials')
    and exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and public.admin_can_access_year(d.year_id)
    )
  );

drop policy if exists ps_day_practice_q_student_select on public.prof_session_day_practice_questions;
create policy ps_day_practice_q_student_select on public.prof_session_day_practice_questions
  for select using (
    exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and d.status = 'published'
        and d.deleted_at is null
        and public.has_active_enrollment(d.year_id)
        and public.has_live_subscription()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Admin Day RPCs (subject-scoped)
-- ---------------------------------------------------------------------------

drop function if exists public.admin_create_prof_session_day(uuid, text, int);

create or replace function public.admin_create_prof_session_day(
  p_subject_id uuid,
  p_name text,
  p_sort_order int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_sort int;
  v_day_id uuid;
  v_year_id uuid;
  v_key text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select s.year_id, s.product_key into v_year_id, v_key
  from public.subjects s where s.id = p_subject_id;
  if v_year_id is null then
    raise exception 'invalid_subject';
  end if;
  if v_key is null or btrim(v_key) = '' then
    raise exception 'subject_not_product_block';
  end if;
  if not public.admin_can_access_year(v_year_id) then
    raise exception 'year_scope_denied';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'invalid_name';
  end if;

  if p_sort_order is null then
    select coalesce(max(sort_order), 0) + 1 into v_sort
    from public.prof_session_days
    where subject_id = p_subject_id and deleted_at is null;
  else
    v_sort := p_sort_order;
  end if;

  insert into public.prof_session_days (
    year_id, subject_id, name, sort_order, status, created_by
  ) values (
    v_year_id, p_subject_id, v_name, v_sort, 'draft', v_uid
  )
  returning id into v_day_id;

  insert into public.prof_session_day_slots (day_id, slot_key)
  values
    (v_day_id, 'guidelines'),
    (v_day_id, 'los'),
    (v_day_id, 'one_liners'),
    (v_day_id, 'practice_mcqs'),
    (v_day_id, 'test_mcq');

  perform public.log_audit(
    'prof_session_day_created',
    'prof_session_day',
    v_day_id,
    jsonb_build_object(
      'year_id', v_year_id,
      'subject_id', p_subject_id,
      'name', v_name,
      'sort_order', v_sort
    )
  );

  return v_day_id;
end;
$$;

revoke execute on function public.admin_create_prof_session_day(uuid, text, int) from public, anon;
grant execute on function public.admin_create_prof_session_day(uuid, text, int) to authenticated, service_role;

drop function if exists public.admin_reorder_prof_session_days(uuid, uuid[]);

create or replace function public.admin_reorder_prof_session_days(
  p_subject_id uuid,
  p_day_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_i int;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select year_id into v_year_id from public.subjects where id = p_subject_id;
  if v_year_id is null then
    raise exception 'invalid_subject';
  end if;
  if not public.admin_can_access_year(v_year_id) then
    raise exception 'year_scope_denied';
  end if;

  if p_day_ids is null or cardinality(p_day_ids) = 0 then
    raise exception 'invalid_day_ids';
  end if;

  for v_i in 1 .. cardinality(p_day_ids) loop
    v_id := p_day_ids[v_i];
    update public.prof_session_days
    set sort_order = v_i, updated_at = now()
    where id = v_id
      and subject_id = p_subject_id
      and deleted_at is null;
    if not found then
      raise exception 'day_not_in_subject';
    end if;
  end loop;

  perform public.log_audit(
    'prof_session_days_reordered',
    'subject',
    p_subject_id,
    jsonb_build_object('day_ids', to_jsonb(p_day_ids))
  );
end;
$$;

revoke execute on function public.admin_reorder_prof_session_days(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_prof_session_days(uuid, uuid[]) to authenticated, service_role;

-- Keep update/soft-delete/restore signatures; they already key by day_id.

create or replace function public.admin_set_day_practice_questions(
  p_day_id uuid,
  p_question_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prof_session_days%rowtype;
  v_qid uuid;
  v_i int;
  v_subj uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.prof_session_days where id = p_day_id;
  if not found then
    raise exception 'day_not_found';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'day_deleted';
  end if;
  if v_row.subject_id is null then
    raise exception 'subject_id_required';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  delete from public.prof_session_day_practice_questions where day_id = p_day_id;

  if p_question_ids is null or cardinality(p_question_ids) = 0 then
    return;
  end if;

  for v_i in 1 .. cardinality(p_question_ids) loop
    v_qid := p_question_ids[v_i];
    select subject_id into v_subj from public.questions where id = v_qid;
    if v_subj is null then
      raise exception 'question_not_found';
    end if;
    if v_subj is distinct from v_row.subject_id then
      raise exception 'question_subject_mismatch';
    end if;
    insert into public.prof_session_day_practice_questions (day_id, question_id, sort_order)
    values (p_day_id, v_qid, v_i)
    on conflict (day_id, question_id) do update set sort_order = excluded.sort_order;
  end loop;

  perform public.log_audit(
    'prof_session_day_practice_set',
    'prof_session_day',
    p_day_id,
    jsonb_build_object('count', cardinality(p_question_ids))
  );
end;
$$;

revoke execute on function public.admin_set_day_practice_questions(uuid, uuid[]) from public, anon;
grant execute on function public.admin_set_day_practice_questions(uuid, uuid[]) to authenticated, service_role;

create or replace function public.list_day_practice_question_ids(p_day_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.prof_session_days%rowtype;
  v_ids uuid[];
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row from public.prof_session_days where id = p_day_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'day_not_found';
  end if;

  if public.has_permission('manage_materials')
     and public.admin_can_access_year(v_row.year_id) then
    null;
  elsif v_row.status = 'published'
        and public.has_active_enrollment(v_row.year_id)
        and public.has_live_subscription() then
    null;
  else
    raise exception 'permission_denied';
  end if;

  select coalesce(array_agg(question_id order by sort_order, question_id), '{}'::uuid[])
  into v_ids
  from public.prof_session_day_practice_questions
  where day_id = p_day_id;

  return v_ids;
end;
$$;

revoke execute on function public.list_day_practice_question_ids(uuid) from public, anon;
grant execute on function public.list_day_practice_question_ids(uuid) to authenticated, service_role;
-- ---------------------------------------------------------------------------
-- 7. Restore requires subject_id (cannot restore year-orphans without mapping)
-- ---------------------------------------------------------------------------

create or replace function public.admin_restore_prof_session_day(p_day_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prof_session_days%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.prof_session_days where id = p_day_id;
  if not found then
    raise exception 'day_not_found';
  end if;
  if v_row.deleted_at is null then
    raise exception 'not_deleted';
  end if;
  if v_row.subject_id is null then
    raise exception 'subject_id_required';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.prof_session_days
  set
    deleted_at = null,
    purge_after = null,
    deleted_by = null,
    updated_at = now()
  where id = p_day_id;

  perform public.log_audit(
    'prof_session_day_restored',
    'prof_session_day',
    p_day_id,
    jsonb_build_object(
      'year_id', v_row.year_id,
      'subject_id', v_row.subject_id,
      'name', v_row.name
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. get_academic_tree — nest Prof. Session subjects + days
-- ---------------------------------------------------------------------------

create or replace function public.get_academic_tree(p_surface text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year_id uuid;
  v_year_number int;
  v_year_name text;
  v_live boolean;
  v_subjects jsonb := '[]'::jsonb;
  v_subj record;
  v_cats jsonb;
  v_folders jsonb;
  v_prof jsonb;
  v_ps_subjects jsonb := '[]'::jsonb;
  v_ps_folders jsonb;
  v_days jsonb;
  v_day record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_surface not in ('resources', 'library') then
    raise exception 'invalid_surface';
  end if;

  select e.year_id, y.year_number, y.name
  into v_year_id, v_year_number, v_year_name
  from public.enrollments e
  join public.years y on y.id = e.year_id
  where e.student_id = v_uid and e.status = 'active';

  if v_year_id is null then
    raise exception 'no_active_enrollment';
  end if;

  v_live := public.has_live_subscription();

  if v_year_number = 5 then
    v_year_name := 'Final Year MBBS';
  end if;

  -- Academic product subjects (unchanged chrome; academic surface folders only)
  for v_subj in
    select s.id, s.name, s.sort_order, s.product_key, s.entitlement, s.required_plan_id
    from public.subjects s
    where s.year_id = v_year_id
      and s.product_key is not null
    order by s.sort_order, s.name
  loop
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'folder_id', f.id,
        'name', f.name,
        'locked', not public.can_access_material_folder(f.id),
        'parent_id', f.parent_id,
        'library_type', f.library_type
      )
      order by f.sort_order, f.name
    ), '[]'::jsonb)
    into v_folders
    from public.material_folders f
    where f.year_id = v_year_id
      and f.subject_id = v_subj.id
      and f.deleted_at is null
      and coalesce(f.content_surface, 'academic') = 'academic'
      and f.prof_session_day_id is null
      and public.can_view_material_folder(f.id);

    select jsonb_agg(cat order by ord) into v_cats
    from (
      select 1 as ord, jsonb_build_object(
        'library_type', 'mcq_bank', 'name', 'MCQ Bank',
        'locked', false, 'placeholder', false, 'folders', '[]'::jsonb
      ) as cat
      union all
      select 2, jsonb_build_object(
        'library_type', 'pearl_points', 'name', 'Pearl Points',
        'locked', false, 'placeholder', false, 'folders', '[]'::jsonb
      )
      union all
      select 3, jsonb_build_object(
        'library_type', 'guidelines', 'name', 'Guidelines',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'guidelines'
        ), '[]'::jsonb)
      )
      union all
      select 4, jsonb_build_object(
        'library_type', 'ospe_material', 'name', 'OSPE Material',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'ospe_material'
        ), '[]'::jsonb)
      )
      union all
      select 5, jsonb_build_object(
        'library_type', 'ospe_lectures', 'name', 'OSPE Lectures',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'ospe_lectures'
        ), '[]'::jsonb)
      )
      union all
      select 6, jsonb_build_object(
        'library_type', 'books', 'name', 'Books',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'books'
        ), '[]'::jsonb)
      )
      union all
      select 7, jsonb_build_object(
        'library_type', 'notes', 'name', 'Notes',
        'locked', false, 'placeholder', true,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'notes'
        ), '[]'::jsonb)
      )
      union all
      select 8, jsonb_build_object(
        'library_type', 'lectures', 'name', 'Lectures',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'lectures'
        ), '[]'::jsonb)
      )
    ) cats;

    v_subjects := v_subjects || jsonb_build_array(
      jsonb_build_object(
        'subject_id', v_subj.id,
        'name', v_subj.name,
        'product_key', v_subj.product_key,
        'locked', false,
        'categories', coalesce(v_cats, '[]'::jsonb)
      )
    );
  end loop;

  if not v_live then
    v_prof := jsonb_build_object('locked', true, 'subjects', '[]'::jsonb);
  else
    for v_subj in
      select s.id, s.name, s.sort_order, s.product_key
      from public.subjects s
      where s.year_id = v_year_id
        and s.product_key is not null
      order by s.sort_order, s.name
    loop
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'folder_id', f.id,
          'name', f.name,
          'locked', not public.can_access_material_folder(f.id),
          'parent_id', f.parent_id,
          'library_type', f.library_type
        )
        order by f.sort_order, f.name
      ), '[]'::jsonb)
      into v_ps_folders
      from public.material_folders f
      where f.year_id = v_year_id
        and f.subject_id = v_subj.id
        and f.deleted_at is null
        and f.content_surface = 'prof_session'
        and f.prof_session_day_id is null
        and public.can_view_material_folder(f.id);

      select coalesce(jsonb_agg(
        jsonb_build_object(
          'day_id', d.id,
          'name', d.name,
          'sort_order', d.sort_order,
          'practice_count', (
            select count(*)::int from public.prof_session_day_practice_questions pq
            where pq.day_id = d.id
          ),
          'test_count', (
            select count(*)::int from public.tests t
            where t.prof_session_day_id = d.id
              and t.status is distinct from 'archived'
          ),
          'one_liner_count', (
            select count(*)::int from public.one_liners ol
            where ol.prof_session_day_id = d.id
              and ol.deleted_at is null
              and ol.status = 'published'
          ),
          'has_guidelines', exists (
            select 1 from public.material_folders mf
            where mf.prof_session_day_id = d.id
              and mf.day_slot_key = 'guidelines'
              and mf.deleted_at is null
          ),
          'has_los', exists (
            select 1 from public.material_folders mf
            where mf.prof_session_day_id = d.id
              and mf.day_slot_key = 'los'
              and mf.deleted_at is null
          ),
          'slots', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'slot_key', sl.slot_key,
                'name', case sl.slot_key
                  when 'guidelines' then 'Guidelines'
                  when 'los' then 'LoS'
                  when 'one_liners' then 'One-Liners'
                  when 'practice_mcqs' then 'Practice MCQs'
                  when 'test_mcq' then 'Test MCQs'
                end
              )
              order by case sl.slot_key
                when 'guidelines' then 1
                when 'los' then 2
                when 'practice_mcqs' then 3
                when 'test_mcq' then 4
                when 'one_liners' then 5
              end
            ), '[]'::jsonb)
            from public.prof_session_day_slots sl
            where sl.day_id = d.id
          )
        )
        order by d.sort_order, d.name
      ), '[]'::jsonb)
      into v_days
      from public.prof_session_days d
      where d.subject_id = v_subj.id
        and d.status = 'published'
        and d.deleted_at is null;

      v_ps_subjects := v_ps_subjects || jsonb_build_array(
        jsonb_build_object(
          'subject_id', v_subj.id,
          'name', v_subj.name,
          'product_key', v_subj.product_key,
          'folders', coalesce(v_ps_folders, '[]'::jsonb),
          'days', coalesce(v_days, '[]'::jsonb)
        )
      );
    end loop;

    v_prof := jsonb_build_object(
      'locked', false,
      'subjects', coalesce(v_ps_subjects, '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'surface', p_surface,
    'year_id', v_year_id,
    'year_number', v_year_number,
    'year_name', v_year_name,
    'subjects', v_subjects,
    'prof_session', v_prof
  );
end;
$$;

comment on function public.get_academic_tree(text) is
  'Product Blocks + categories + Prof. Session subjects with day-scoped MCQ Bank. Soft-deleted excluded. Free: prof_session locked.';

-- ---------------------------------------------------------------------------
-- 9. search_academic_tree — subject-scoped day hits with product_key
-- ---------------------------------------------------------------------------

create or replace function public.search_academic_tree(
  p_query text,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year_id uuid;
  v_year_name text;
  v_live boolean;
  v_q text;
  v_limit int;
  v_hits jsonb := '[]'::jsonb;
  v_cat record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  v_q := lower(btrim(coalesce(p_query, '')));
  if v_q = '' then
    return '[]'::jsonb;
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_live := public.has_live_subscription();

  select e.year_id,
    case when y.year_number = 5 then 'Final Year MBBS' else y.name end
  into v_year_id, v_year_name
  from public.enrollments e
  join public.years y on y.id = e.year_id
  where e.student_id = v_uid and e.status = 'active';

  if v_year_id is null then
    raise exception 'no_active_enrollment';
  end if;

  if lower(v_year_name) like '%' || v_q || '%' then
    v_hits := v_hits || jsonb_build_array(jsonb_build_object(
      'kind', 'class',
      'id', v_year_id,
      'name', v_year_name,
      'path_labels', jsonb_build_array(v_year_name),
      'locked', false
    ));
  end if;

  select coalesce(v_hits || jsonb_agg(
    jsonb_build_object(
      'kind', 'block',
      'id', s.id,
      'name', s.name,
      'product_key', s.product_key,
      'path_labels', jsonb_build_array(v_year_name, s.name),
      'locked', false
    )
  ), v_hits)
  into v_hits
  from (
    select s.id, s.name, s.product_key
    from public.subjects s
    where s.year_id = v_year_id
      and s.product_key is not null
      and lower(s.name) like '%' || v_q || '%'
    order by s.sort_order, s.name
    limit v_limit
  ) s;

  for v_cat in
    select *
    from (
      values
        ('mcq_bank', 'MCQ Bank'),
        ('pearl_points', 'Pearl Points'),
        ('guidelines', 'Guidelines'),
        ('ospe_material', 'OSPE Material'),
        ('ospe_lectures', 'OSPE Lectures'),
        ('books', 'Books'),
        ('notes', 'Notes'),
        ('lectures', 'Lectures'),
        ('syllabus', 'Syllabus'),
        ('schedule', 'Schedule'),
        ('ospe_past', 'Past OSPE')
    ) as c(library_type, name)
    where lower(c.name) like '%' || v_q || '%'
  loop
    v_hits := v_hits || jsonb_build_array(jsonb_build_object(
      'kind', 'category',
      'id', v_cat.library_type,
      'name', v_cat.name,
      'path_labels', jsonb_build_array(v_year_name, v_cat.name),
      'locked', false
    ));
  end loop;

  select coalesce(v_hits || jsonb_agg(
    jsonb_build_object(
      'kind', 'folder',
      'id', f.id,
      'name', f.name,
      'path_labels', jsonb_build_array(v_year_name, coalesce(subj.name, ''), f.name),
      'locked', not public.can_access_material_folder(f.id)
    )
  ), v_hits)
  into v_hits
  from (
    select f.id, f.name, f.subject_id
    from public.material_folders f
    where f.year_id = v_year_id
      and f.deleted_at is null
      and f.prof_session_day_id is null
      and public.can_view_material_folder(f.id)
      and lower(f.name) like '%' || v_q || '%'
    order by f.sort_order, f.name
    limit v_limit
  ) f
  left join public.subjects subj on subj.id = f.subject_id;

  if v_live then
    if position(v_q in lower('prof. session')) > 0 then
      v_hits := v_hits || jsonb_build_array(jsonb_build_object(
        'kind', 'prof_session',
        'id', v_year_id::text || ':prof-session',
        'name', 'Prof. Session',
        'path_labels', jsonb_build_array(v_year_name, 'Prof. Session'),
        'locked', false
      ));
    end if;

    select coalesce(v_hits || jsonb_agg(
      jsonb_build_object(
        'kind', 'prof_session_day',
        'id', d.id,
        'name', d.name,
        'product_key', d.product_key,
        'path_labels', jsonb_build_array(
          v_year_name, 'Prof. Session', d.subject_name, 'MCQ Bank', d.name
        ),
        'locked', false
      )
    ), v_hits)
    into v_hits
    from (
      select d.id, d.name, s.name as subject_name, s.product_key
      from public.prof_session_days d
      join public.subjects s on s.id = d.subject_id
      where d.year_id = v_year_id
        and d.subject_id is not null
        and d.status = 'published'
        and d.deleted_at is null
        and lower(d.name) like '%' || v_q || '%'
      order by d.sort_order, d.name
      limit v_limit
    ) d;
  end if;

  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb)
    from (
      select x
      from jsonb_array_elements(v_hits) x
      limit v_limit
    ) t
  );
end;
$$;

revoke execute on function public.search_academic_tree(text, int) from public, anon;
grant execute on function public.search_academic_tree(text, int) to authenticated, service_role;

comment on function public.search_academic_tree(text, int) is
  'Search product blocks, categories, folders, and (when subscribed) subject-scoped prof session days with product_key.';
