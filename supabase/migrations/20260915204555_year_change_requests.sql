-- Step 8I: year_change_requests + student/admin RPCs.
-- Canonical: docs/database.md, docs/permissions.md.
-- Approve expires the live enrollment and inserts active for to_year_id
-- (same transition shape as promote_student). Does not touch account_status
-- or subscriptions.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table public.year_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  from_year_id uuid not null references public.years (id),
  to_year_id uuid not null references public.years (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reason text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_year_id is distinct from to_year_id)
);

comment on table public.year_change_requests is
  'Student requests to move class enrollment to another MBBS year. Writes via RPC only.';
comment on column public.year_change_requests.from_year_id is
  'Snapshot of the student''s active enrollment year at request time.';
comment on column public.year_change_requests.reason is
  'Optional student-provided reason.';
comment on column public.year_change_requests.review_note is
  'Optional admin note on approve/reject.';

create unique index year_change_requests_one_pending
  on public.year_change_requests (student_id)
  where status = 'pending';

create index year_change_requests_student_idx
  on public.year_change_requests (student_id);

create index year_change_requests_status_idx
  on public.year_change_requests (status);

create index year_change_requests_created_idx
  on public.year_change_requests (created_at desc);

create trigger year_change_requests_updated_at
  before update on public.year_change_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (writes are RPC-only)
-- ---------------------------------------------------------------------------
alter table public.year_change_requests enable row level security;

create policy year_change_requests_select on public.year_change_requests
  for select using (
    student_id = (select auth.uid())
    or public.is_admin()
  );

create or replace function public.protect_year_change_request()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('medverse.year_change_request_rpc', true) is distinct from '1' then
    raise exception 'year_change_request_rpc_only';
  end if;
  return new;
end;
$$;

drop trigger if exists year_change_requests_rpc_only on public.year_change_requests;
create trigger year_change_requests_rpc_only
  before insert or update or delete on public.year_change_requests
  for each row execute function public.protect_year_change_request();

-- ---------------------------------------------------------------------------
-- Student RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_year_change_request(
  p_to_year_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_from uuid;
  v_to uuid;
  v_id uuid;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select e.year_id into v_from
  from public.enrollments e
  where e.student_id = v_uid and e.status = 'active';
  if v_from is null then
    raise exception 'no_active_enrollment';
  end if;

  select y.id into v_to
  from public.years y
  where y.id = p_to_year_id;
  if v_to is null then
    raise exception 'year_not_found';
  end if;
  if v_to = v_from then
    raise exception 'same_year';
  end if;

  if exists (
    select 1 from public.year_change_requests
    where student_id = v_uid and status = 'pending'
  ) then
    raise exception 'year_change_already_pending';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  perform set_config('medverse.year_change_request_rpc', '1', true);
  insert into public.year_change_requests (
    student_id, from_year_id, to_year_id, status, reason
  ) values (
    v_uid, v_from, v_to, 'pending', v_reason
  )
  returning id into v_id;
  perform set_config('medverse.year_change_request_rpc', '', true);
  return v_id;
exception
  when unique_violation then
    perform set_config('medverse.year_change_request_rpc', '', true);
    raise exception 'year_change_already_pending';
  when others then
    perform set_config('medverse.year_change_request_rpc', '', true);
    raise;
end;
$$;

create or replace function public.update_pending_year_change_request(
  p_request_id uuid,
  p_to_year_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.year_change_requests%rowtype;
  v_to uuid;
  v_from uuid;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select * into v_row
  from public.year_change_requests
  where id = p_request_id;
  if not found or v_row.student_id is distinct from v_uid then
    raise exception 'year_change_not_found';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'year_change_not_pending';
  end if;

  select e.year_id into v_from
  from public.enrollments e
  where e.student_id = v_uid and e.status = 'active';
  if v_from is null then
    raise exception 'no_active_enrollment';
  end if;

  v_to := coalesce(p_to_year_id, v_row.to_year_id);
  if not exists (select 1 from public.years where id = v_to) then
    raise exception 'year_not_found';
  end if;
  if v_to = v_from then
    raise exception 'same_year';
  end if;

  if p_reason is null then
    v_reason := v_row.reason;
  else
    v_reason := nullif(btrim(p_reason), '');
  end if;

  perform set_config('medverse.year_change_request_rpc', '1', true);
  update public.year_change_requests
  set
    from_year_id = v_from,
    to_year_id = v_to,
    reason = v_reason
  where id = v_row.id;
  perform set_config('medverse.year_change_request_rpc', '', true);
exception
  when others then
    perform set_config('medverse.year_change_request_rpc', '', true);
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------
create or replace function public.approve_year_change_request(
  p_request_id uuid,
  p_review_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.year_change_requests%rowtype;
  v_current public.enrollments%rowtype;
  v_new_id uuid;
  v_note text;
  v_account text;
begin
  perform public.require_permission('manage_year_changes');

  select * into v_row
  from public.year_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'year_change_not_found';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'year_change_not_pending';
  end if;

  -- Year change must not be used to "fix" a blocked account. Enrollment
  -- may still move so class assignment stays correct; LMS entry remains gated
  -- by account_status.
  select account_status into v_account
  from public.profiles
  where id = v_row.student_id;
  if v_account is null then
    raise exception 'year_change_not_found';
  end if;

  if not exists (select 1 from public.years where id = v_row.to_year_id) then
    raise exception 'year_not_found';
  end if;

  select * into v_current
  from public.enrollments
  where student_id = v_row.student_id and status = 'active'
  for update;
  if not found then
    raise exception 'no_active_enrollment';
  end if;
  if v_current.year_id = v_row.to_year_id then
    raise exception 'same_year';
  end if;

  v_note := nullif(btrim(coalesce(p_review_note, '')), '');

  -- Expire live class, insert the requested year (one active via unique index).
  update public.enrollments
  set status = 'expired'
  where id = v_current.id;

  insert into public.enrollments (
    student_id, year_id, status, approved_by, approved_at
  ) values (
    v_row.student_id,
    v_row.to_year_id,
    'active',
    (select auth.uid()),
    now()
  )
  returning id into v_new_id;

  perform set_config('medverse.year_change_request_rpc', '1', true);
  update public.year_change_requests
  set
    status = 'approved',
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    review_note = v_note
  where id = v_row.id;
  perform set_config('medverse.year_change_request_rpc', '', true);

  perform public.log_audit(
    'year_change_approved',
    'year_change_request',
    v_row.id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'from_year_id', v_current.year_id,
      'to_year_id', v_row.to_year_id,
      'enrollment_id', v_new_id,
      'request_from_year_id', v_row.from_year_id,
      'account_status', v_account,
      'review_note', v_note
    )
  );

  return v_new_id;
exception
  when others then
    perform set_config('medverse.year_change_request_rpc', '', true);
    raise;
end;
$$;

create or replace function public.reject_year_change_request(
  p_request_id uuid,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.year_change_requests%rowtype;
  v_note text;
begin
  perform public.require_permission('manage_year_changes');

  select * into v_row
  from public.year_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'year_change_not_found';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'year_change_not_pending';
  end if;

  v_note := nullif(btrim(coalesce(p_review_note, '')), '');

  perform set_config('medverse.year_change_request_rpc', '1', true);
  update public.year_change_requests
  set
    status = 'rejected',
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    review_note = v_note
  where id = v_row.id;
  perform set_config('medverse.year_change_request_rpc', '', true);

  perform public.log_audit(
    'year_change_rejected',
    'year_change_request',
    v_row.id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'from_year_id', v_row.from_year_id,
      'to_year_id', v_row.to_year_id,
      'review_note', v_note
    )
  );
exception
  when others then
    perform set_config('medverse.year_change_request_rpc', '', true);
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.create_year_change_request(uuid, text) from public, anon;
revoke execute on function public.update_pending_year_change_request(uuid, uuid, text) from public, anon;
revoke execute on function public.approve_year_change_request(uuid, text) from public, anon;
revoke execute on function public.reject_year_change_request(uuid, text) from public, anon;

grant execute on function public.create_year_change_request(uuid, text) to authenticated, service_role;
grant execute on function public.update_pending_year_change_request(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.approve_year_change_request(uuid, text) to authenticated, service_role;
grant execute on function public.reject_year_change_request(uuid, text) to authenticated, service_role;
