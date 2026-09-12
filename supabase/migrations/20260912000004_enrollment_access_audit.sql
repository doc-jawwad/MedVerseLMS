-- 0004: enrollments, access grants, audit log; student curriculum visibility (docs/permissions.md)

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  year_id uuid not null references public.years (id),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'expired', 'revoked')),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one live (pending/active) enrollment per student
create unique index enrollments_one_live
  on public.enrollments (student_id)
  where status in ('pending', 'active');

create index enrollments_year_status_idx on public.enrollments (year_id, status);

create trigger enrollments_updated_at before update on public.enrollments
  for each row execute function public.set_updated_at();

-- access_grants: per-student overrides (docs/database.md).
-- test_id / folder_id have no FK yet; added when those tables exist.
create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  grant_type text not null check (grant_type in ('practice_subject', 'test', 'materials_folder')),
  subject_id uuid references public.subjects (id) on delete cascade,
  test_id uuid,
  folder_id uuid,
  granted_by uuid references public.profiles (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (grant_type = 'practice_subject' and subject_id is not null and test_id is null and folder_id is null) or
    (grant_type = 'test'             and test_id is not null and subject_id is null and folder_id is null) or
    (grant_type = 'materials_folder' and folder_id is not null and subject_id is null and test_id is null)
  )
);

create unique index access_grants_unique_target
  on public.access_grants (student_id, grant_type, coalesce(subject_id, test_id, folder_id))
  where revoked_at is null;

create index access_grants_student_idx on public.access_grants (student_id) where revoked_at is null;

create trigger access_grants_updated_at before update on public.access_grants
  for each row execute function public.set_updated_at();

-- audit log: insert-only, via log_audit() from RPCs/actions
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id);

create or replace function public.log_audit(
  p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

-- helpers
create or replace function public.has_active_enrollment(p_year_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.enrollments
    where student_id = (select auth.uid()) and status = 'active' and year_id = p_year_id
  );
$$;

create or replace function public.active_enrollment_year()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select year_id from public.enrollments
  where student_id = (select auth.uid()) and status = 'active'
  limit 1;
$$;

-- Signup: the client passes year_id in auth metadata; create the pending enrollment too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );

  v_year := nullif(new.raw_user_meta_data ->> 'year_id', '')::uuid;
  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    values (new.id, v_year, 'pending');
  end if;

  return new;
end;
$$;

-- Admin enrollment RPCs (audit-logged)
create or replace function public.set_enrollment_status(p_enrollment_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.enrollments%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_status not in ('active', 'suspended', 'expired', 'revoked') then
    raise exception 'invalid status %', p_status;
  end if;

  update public.enrollments
  set status = p_status,
      approved_by = case when p_status = 'active' then (select auth.uid()) else approved_by end,
      approved_at = case when p_status = 'active' then now() else approved_at end
  where id = p_enrollment_id
  returning * into v_row;

  if not found then
    raise exception 'enrollment not found';
  end if;

  perform public.log_audit('enrollment_' || p_status, 'enrollment', p_enrollment_id,
    jsonb_build_object('student_id', v_row.student_id, 'year_id', v_row.year_id));
end;
$$;

create or replace function public.promote_student(p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.enrollments%rowtype;
  v_next_year uuid;
  v_new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select * into v_current from public.enrollments
  where student_id = p_student_id and status = 'active';
  if not found then
    raise exception 'no active enrollment';
  end if;

  select y2.id into v_next_year
  from public.years y1
  join public.years y2 on y2.year_number = y1.year_number + 1
  where y1.id = v_current.year_id;
  if v_next_year is null then
    raise exception 'already in final year';
  end if;

  update public.enrollments set status = 'expired' where id = v_current.id;
  insert into public.enrollments (student_id, year_id, status, approved_by, approved_at)
  values (p_student_id, v_next_year, 'active', (select auth.uid()), now())
  returning id into v_new_id;

  perform public.log_audit('student_promoted', 'enrollment', v_new_id,
    jsonb_build_object('student_id', p_student_id, 'from_year', v_current.year_id, 'to_year', v_next_year));
  return v_new_id;
end;
$$;

-- RLS
alter table public.enrollments enable row level security;
alter table public.access_grants enable row level security;
alter table public.audit_logs enable row level security;

create policy enrollments_student_select on public.enrollments
  for select using (student_id = (select auth.uid()) or public.is_admin());
create policy enrollments_admin_write on public.enrollments
  for all using (public.is_admin()) with check (public.is_admin());

create policy access_grants_student_select on public.access_grants
  for select using (student_id = (select auth.uid()) or public.is_admin());
create policy access_grants_admin_write on public.access_grants
  for all using (public.is_admin()) with check (public.is_admin());

create policy audit_logs_admin_select on public.audit_logs
  for select using (public.is_admin());
-- inserts only via log_audit (definer); no other policies.

-- Exam-session eviction exemption (docs/permissions.md). v1 stub: no attempts
-- table yet, so no exemption. Phase 7 REPLACES this to check in_progress attempts.
create or replace function public.owns_live_attempt_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select false $$;

-- Signup page (anon) needs the year list before any session exists.
create or replace function public.list_years()
returns table (id uuid, year_number int, name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, year_number, name from public.years order by year_number;
$$;

grant execute on function public.list_years() to anon;

-- Student curriculum visibility (deferred from 0003): active enrollment's year only.
create policy years_student_select on public.years
  for select using (public.has_active_enrollment(id));
create policy subjects_student_select on public.subjects
  for select using (public.has_active_enrollment(year_id));
create policy books_student_select on public.books
  for select using (public.has_active_enrollment(year_id));
create policy chapters_student_select on public.chapters
  for select using (public.has_active_enrollment(year_id));
create policy topics_student_select on public.topics
  for select using (public.has_active_enrollment(year_id));
