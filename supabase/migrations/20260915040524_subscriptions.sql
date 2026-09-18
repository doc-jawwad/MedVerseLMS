-- Step 8E: subscription_plans + subscriptions lifecycle.
-- Does NOT add applications, payment_settings, R2, notifications, or UI.
-- Replaces the Step 8D has_live_subscription / has_live_plan stubs.
-- Renewal updates the existing active row (extend ends_at from current end).

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  name text not null,
  description text not null default '',
  duration_days int not null check (duration_days > 0),
  is_complimentary boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscription_plans_active_idx
  on public.subscription_plans (sort_order, name)
  where is_active;

create trigger subscription_plans_updated_at
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

comment on column public.subscription_plans.is_complimentary is
  'Complimentary paid-resource access is a plan, not a profiles flag.';

insert into public.subscription_plans (name, description, duration_days, is_complimentary, is_active, sort_order)
values (
  'Standard',
  'MedVerse subscription',
  365,
  false,
  true,
  0
);

-- required_plan_id can now reference a real plan (docs/database.md).
alter table public.tests
  add constraint tests_required_plan_fk
  foreign key (required_plan_id) references public.subscription_plans (id);
alter table public.subjects
  add constraint subjects_required_plan_fk
  foreign key (required_plan_id) references public.subscription_plans (id);
alter table public.material_folders
  add constraint material_folders_required_plan_fk
  foreign key (required_plan_id) references public.subscription_plans (id);

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id),
  status text not null check (status in ('active', 'expired', 'deactivated')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  application_id uuid,
  activated_by uuid references public.profiles (id),
  activated_at timestamptz,
  deactivated_by uuid references public.profiles (id),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

comment on column public.subscriptions.application_id is
  'Nullable until subscription_applications exists. No FK in this step.';

create unique index subscriptions_one_active
  on public.subscriptions (student_id)
  where status = 'active';

create index subscriptions_active_ends_idx
  on public.subscriptions (ends_at)
  where status = 'active';

create index subscriptions_student_idx
  on public.subscriptions (student_id);

create index subscriptions_plan_idx
  on public.subscriptions (plan_id);

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;

-- Students: own subscription history; active plan catalog. Writes are RPC-only.
create policy subscription_plans_student_select on public.subscription_plans
  for select using (is_active or public.is_admin());
create policy subscriptions_student_select on public.subscriptions
  for select using (student_id = (select auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------------------
-- Live evaluation (server now(); do not trust status alone)
-- ---------------------------------------------------------------------------
create or replace function public.expire_due_subscriptions(p_student_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid := p_student_id;
  v_count int;
begin
  if v_student is null then
    if public.is_admin() or (select auth.uid()) is null then
      null;
    else
      v_student := (select auth.uid());
    end if;
  elsif (select auth.uid()) is not null
     and not public.is_admin()
     and v_student is distinct from (select auth.uid()) then
    v_student := (select auth.uid());
  end if;

  update public.subscriptions
  set status = 'expired'
  where status = 'active'
    and ends_at <= now()
    and (v_student is null or student_id = v_student);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.has_live_subscription()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.subscriptions s
      where s.student_id = (select auth.uid())
        and s.status = 'active'
        and now() < s.ends_at
    );
$$;

create or replace function public.has_live_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and p_plan_id is not null
    and exists (
      select 1 from public.subscriptions s
      where s.student_id = (select auth.uid())
        and s.plan_id = p_plan_id
        and s.status = 'active'
        and now() < s.ends_at
    );
$$;

-- ---------------------------------------------------------------------------
-- Plan RPCs (manage_subscriptions — catalog for the subscription subsystem)
-- ---------------------------------------------------------------------------
create or replace function public.create_subscription_plan(
  p_name text,
  p_description text default '',
  p_duration_days int default 365,
  p_is_complimentary boolean default false,
  p_is_active boolean default true,
  p_sort_order int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_permission('manage_subscriptions');
  if p_name is null or btrim(p_name) = '' then
    raise exception 'plan_name_required';
  end if;
  if p_duration_days is null or p_duration_days <= 0 then
    raise exception 'invalid_duration';
  end if;
  insert into public.subscription_plans (
    name, description, duration_days, is_complimentary, is_active, sort_order
  ) values (
    btrim(p_name), coalesce(p_description, ''), p_duration_days,
    coalesce(p_is_complimentary, false), coalesce(p_is_active, true),
    coalesce(p_sort_order, 0)
  )
  returning id into v_id;
  perform public.log_audit(
    'subscription_plan_created',
    'subscription_plan',
    v_id,
    jsonb_build_object(
      'name', btrim(p_name),
      'duration_days', p_duration_days,
      'is_complimentary', coalesce(p_is_complimentary, false)
    )
  );
  return v_id;
end;
$$;

create or replace function public.update_subscription_plan(
  p_plan_id uuid,
  p_name text default null,
  p_description text default null,
  p_duration_days int default null,
  p_is_complimentary boolean default null,
  p_is_active boolean default null,
  p_sort_order int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.subscription_plans%rowtype;
begin
  perform public.require_permission('manage_subscriptions');
  select * into v_old from public.subscription_plans where id = p_plan_id;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if p_duration_days is not null and p_duration_days <= 0 then
    raise exception 'invalid_duration';
  end if;
  if p_name is not null and btrim(p_name) = '' then
    raise exception 'plan_name_required';
  end if;
  update public.subscription_plans
  set
    name = coalesce(nullif(btrim(coalesce(p_name, name)), ''), name),
    description = coalesce(p_description, description),
    duration_days = coalesce(p_duration_days, duration_days),
    is_complimentary = coalesce(p_is_complimentary, is_complimentary),
    is_active = coalesce(p_is_active, is_active),
    sort_order = coalesce(p_sort_order, sort_order)
  where id = p_plan_id;
  perform public.log_audit(
    'subscription_plan_updated',
    'subscription_plan',
    p_plan_id,
    jsonb_build_object(
      'old_name', v_old.name,
      'new_name', coalesce(p_name, v_old.name),
      'old_is_active', v_old.is_active,
      'new_is_active', coalesce(p_is_active, v_old.is_active),
      'old_duration_days', v_old.duration_days,
      'new_duration_days', coalesce(p_duration_days, v_old.duration_days)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Subscription lifecycle RPCs
-- ---------------------------------------------------------------------------
create or replace function public.activate_subscription(
  p_student_id uuid,
  p_plan_id uuid,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_application_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
begin
  perform public.require_permission('manage_subscriptions');
  perform public.expire_due_subscriptions(p_student_id);

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if not v_plan.is_active then
    raise exception 'plan_inactive';
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then
    raise exception 'student_not_found';
  end if;
  if exists (
    select 1 from public.subscriptions
    where student_id = p_student_id
      and status = 'active'
      and now() < ends_at
  ) then
    raise exception 'subscription_already_active';
  end if;

  v_start := coalesce(p_starts_at, now());
  v_end := coalesce(p_ends_at, v_start + make_interval(days => v_plan.duration_days));
  if v_end <= v_start then
    raise exception 'invalid_subscription_window';
  end if;
  if v_end <= now() then
    raise exception 'subscription_already_ended';
  end if;

  insert into public.subscriptions (
    student_id, plan_id, status, starts_at, ends_at, application_id,
    activated_by, activated_at
  ) values (
    p_student_id, p_plan_id, 'active', v_start, v_end, p_application_id,
    (select auth.uid()), now()
  )
  returning id into v_id;

  perform public.log_audit(
    'subscription_activated',
    'subscription',
    v_id,
    jsonb_build_object(
      'student_id', p_student_id,
      'plan_id', p_plan_id,
      'is_complimentary', v_plan.is_complimentary,
      'old_status', null,
      'new_status', 'active',
      'old_starts_at', null,
      'new_starts_at', v_start,
      'old_ends_at', null,
      'new_ends_at', v_end
    )
  );
  return v_id;
end;
$$;

create or replace function public.extend_subscription(
  p_subscription_id uuid,
  p_days int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
  v_days int;
  v_new_end timestamptz;
begin
  perform public.require_permission('manage_subscriptions');
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  perform public.expire_due_subscriptions(v_row.student_id);
  select * into v_row from public.subscriptions where id = p_subscription_id;

  if v_row.status is distinct from 'active' or now() >= v_row.ends_at then
    raise exception 'subscription_not_live';
  end if;

  select coalesce(p_days, duration_days) into v_days
  from public.subscription_plans
  where id = v_row.plan_id;
  if v_days is null or v_days <= 0 then
    raise exception 'invalid_duration';
  end if;

  v_new_end := v_row.ends_at + make_interval(days => v_days);
  update public.subscriptions
  set ends_at = v_new_end
  where id = p_subscription_id;

  perform public.log_audit(
    'subscription_extended',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'old_status', v_row.status,
      'new_status', 'active',
      'old_starts_at', v_row.starts_at,
      'new_starts_at', v_row.starts_at,
      'old_ends_at', v_row.ends_at,
      'new_ends_at', v_new_end,
      'days', v_days
    )
  );
end;
$$;

create or replace function public.set_subscription_end(
  p_subscription_id uuid,
  p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
  v_new_status text;
begin
  perform public.require_permission('manage_subscriptions');
  if p_ends_at is null then
    raise exception 'invalid_subscription_window';
  end if;
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  if v_row.status is distinct from 'active' then
    raise exception 'subscription_not_active';
  end if;
  if p_ends_at <= v_row.starts_at then
    raise exception 'invalid_subscription_window';
  end if;

  v_new_status := case when p_ends_at <= now() then 'expired' else 'active' end;
  update public.subscriptions
  set ends_at = p_ends_at,
      status = v_new_status
  where id = p_subscription_id;

  perform public.log_audit(
    'subscription_end_changed',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'old_status', v_row.status,
      'new_status', v_new_status,
      'old_starts_at', v_row.starts_at,
      'new_starts_at', v_row.starts_at,
      'old_ends_at', v_row.ends_at,
      'new_ends_at', p_ends_at
    )
  );
end;
$$;

create or replace function public.deactivate_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
begin
  perform public.require_permission('manage_subscriptions');
  update public.subscriptions
  set status = 'deactivated',
      deactivated_by = (select auth.uid()),
      deactivated_at = now()
  where id = p_subscription_id
    and status = 'active'
  returning * into v_row;
  if not found then
    raise exception 'subscription_not_active';
  end if;
  perform public.log_audit(
    'subscription_deactivated',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'old_status', 'active',
      'new_status', 'deactivated',
      'old_starts_at', v_row.starts_at,
      'new_starts_at', v_row.starts_at,
      'old_ends_at', v_row.ends_at,
      'new_ends_at', v_row.ends_at
    )
  );
end;
$$;

create or replace function public.restore_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
begin
  perform public.require_permission('manage_subscriptions');
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  perform public.expire_due_subscriptions(v_row.student_id);
  select * into v_row from public.subscriptions where id = p_subscription_id;

  if v_row.status is distinct from 'deactivated' then
    raise exception 'subscription_not_deactivated';
  end if;
  if v_row.ends_at <= now() then
    raise exception 'subscription_already_ended';
  end if;
  if exists (
    select 1 from public.subscriptions
    where student_id = v_row.student_id
      and status = 'active'
      and id is distinct from p_subscription_id
  ) then
    raise exception 'subscription_already_active';
  end if;

  update public.subscriptions
  set status = 'active',
      activated_by = (select auth.uid()),
      activated_at = now(),
      deactivated_by = null,
      deactivated_at = null
  where id = p_subscription_id;

  perform public.log_audit(
    'subscription_restored',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'old_status', 'deactivated',
      'new_status', 'active',
      'old_starts_at', v_row.starts_at,
      'new_starts_at', v_row.starts_at,
      'old_ends_at', v_row.ends_at,
      'new_ends_at', v_row.ends_at
    )
  );
end;
$$;

create or replace function public.assign_subscription_plan(
  p_subscription_id uuid,
  p_plan_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
begin
  perform public.require_permission('manage_subscriptions');
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  perform public.expire_due_subscriptions(v_row.student_id);
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if v_row.status is distinct from 'active' or now() >= v_row.ends_at then
    raise exception 'subscription_not_live';
  end if;
  select * into v_plan from public.subscription_plans where id = p_plan_id;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if not v_plan.is_active then
    raise exception 'plan_inactive';
  end if;

  update public.subscriptions
  set plan_id = p_plan_id
  where id = p_subscription_id;

  perform public.log_audit(
    'subscription_plan_assigned',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'old_plan_id', v_row.plan_id,
      'new_plan_id', p_plan_id,
      'old_status', v_row.status,
      'new_status', 'active',
      'old_starts_at', v_row.starts_at,
      'new_starts_at', v_row.starts_at,
      'old_ends_at', v_row.ends_at,
      'new_ends_at', v_row.ends_at
    )
  );
end;
$$;

-- Daily expiry normalization. Access still uses now() < ends_at even if this lags.
do $$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.unschedule('medverse-expire-subscriptions');
  exception when others then
    null;
  end;
  begin
    perform cron.schedule(
      'medverse-expire-subscriptions',
      '15 3 * * *',
      'select public.expire_due_subscriptions()'
    );
  exception when others then
    raise notice 'pg_cron unavailable (%), relying on on-read live checks', SQLERRM;
  end;
end $$;

revoke execute on function public.create_subscription_plan(text, text, int, boolean, boolean, int) from public, anon;
grant execute on function public.create_subscription_plan(text, text, int, boolean, boolean, int) to authenticated, service_role;
revoke execute on function public.update_subscription_plan(uuid, text, text, int, boolean, boolean, int) from public, anon;
grant execute on function public.update_subscription_plan(uuid, text, text, int, boolean, boolean, int) to authenticated, service_role;
revoke execute on function public.activate_subscription(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.activate_subscription(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
revoke execute on function public.extend_subscription(uuid, int) from public, anon;
grant execute on function public.extend_subscription(uuid, int) to authenticated, service_role;
revoke execute on function public.set_subscription_end(uuid, timestamptz) from public, anon;
grant execute on function public.set_subscription_end(uuid, timestamptz) to authenticated, service_role;
revoke execute on function public.deactivate_subscription(uuid) from public, anon;
grant execute on function public.deactivate_subscription(uuid) to authenticated, service_role;
revoke execute on function public.restore_subscription(uuid) from public, anon;
grant execute on function public.restore_subscription(uuid) to authenticated, service_role;
revoke execute on function public.assign_subscription_plan(uuid, uuid) from public, anon;
grant execute on function public.assign_subscription_plan(uuid, uuid) to authenticated, service_role;
revoke execute on function public.expire_due_subscriptions(uuid) from public, anon;
grant execute on function public.expire_due_subscriptions(uuid) to authenticated, service_role;
revoke execute on function public.has_live_subscription() from public, anon;
grant execute on function public.has_live_subscription() to authenticated, service_role;
revoke execute on function public.has_live_plan(uuid) from public, anon;
grant execute on function public.has_live_plan(uuid) to authenticated, service_role;
