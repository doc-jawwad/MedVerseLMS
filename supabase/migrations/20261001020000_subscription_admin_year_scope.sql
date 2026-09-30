-- Subscription admin year/class scope + activate plan-year coherence.
-- Wires admin_can_access_year into subscription SELECT RLS and mutate RPCs.
-- Does not recreate 20260930170000 / 20260930180000 application or class-switch logic.
-- Cancellation / pre-grants / Brevo email intentionally untouched.

-- ---------------------------------------------------------------------------
-- Helper: assigned-class gate for limited admins (Main Admin short-circuits)
-- ---------------------------------------------------------------------------
create or replace function public.require_admin_year_scope(p_year_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_year_id is null then
    raise exception 'invalid_year';
  end if;
  if not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;
end;
$$;

comment on function public.require_admin_year_scope(uuid) is
  'Raise year_scope_denied unless caller is Main Admin or assigned to the year.';

revoke execute on function public.require_admin_year_scope(uuid)
  from public, anon, authenticated;
grant execute on function public.require_admin_year_scope(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- RLS: subscriptions / applications / plans — permission + year scope
-- ---------------------------------------------------------------------------
drop policy if exists subscriptions_student_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select using (
    student_id = (select auth.uid())
    or (
      public.has_permission('manage_subscriptions')
      and public.admin_can_access_year(year_id)
    )
  );

drop policy if exists subscription_applications_select on public.subscription_applications;
create policy subscription_applications_select on public.subscription_applications
  for select using (
    student_id = (select auth.uid())
    or (
      public.has_permission('review_subscription_applications')
      and public.admin_can_access_year(year_id)
    )
  );

drop policy if exists subscription_plans_student_select on public.subscription_plans;
create policy subscription_plans_select on public.subscription_plans
  for select using (
    (
      is_active
      and year_id in (
        select e.year_id
        from public.enrollments e
        where e.student_id = (select auth.uid())
          and e.status = 'active'
      )
    )
    or (
      (
        public.has_permission('manage_subscriptions')
        or public.has_permission('review_subscription_applications')
      )
      and public.admin_can_access_year(year_id)
    )
  );

-- ---------------------------------------------------------------------------
-- create_subscription_plan / update_subscription_plan
-- ---------------------------------------------------------------------------
create or replace function public.create_subscription_plan(
  p_name text,
  p_year_id uuid,
  p_price numeric default 0,
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
  if p_year_id is null then
    raise exception 'year_required';
  end if;
  if not exists (select 1 from public.years where id = p_year_id) then
    raise exception 'year_not_found';
  end if;
  perform public.require_admin_year_scope(p_year_id);
  if p_price is null or p_price < 0 then
    raise exception 'invalid_price';
  end if;
  insert into public.subscription_plans (
    name, year_id, price, description, duration_days,
    is_complimentary, is_active, sort_order
  ) values (
    btrim(p_name), p_year_id, p_price, coalesce(p_description, ''),
    p_duration_days, coalesce(p_is_complimentary, false),
    coalesce(p_is_active, true), coalesce(p_sort_order, 0)
  )
  returning id into v_id;
  perform public.log_audit(
    'subscription_plan_created',
    'subscription_plan',
    v_id,
    jsonb_build_object(
      'name', btrim(p_name),
      'year_id', p_year_id,
      'price', p_price,
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
  p_sort_order int default null,
  p_price numeric default null
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
  perform public.require_admin_year_scope(v_old.year_id);
  if p_duration_days is not null and p_duration_days <= 0 then
    raise exception 'invalid_duration';
  end if;
  if p_name is not null and btrim(p_name) = '' then
    raise exception 'plan_name_required';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'invalid_price';
  end if;
  update public.subscription_plans
  set
    name = coalesce(nullif(btrim(coalesce(p_name, name)), ''), name),
    description = coalesce(p_description, description),
    duration_days = coalesce(p_duration_days, duration_days),
    is_complimentary = coalesce(p_is_complimentary, is_complimentary),
    is_active = coalesce(p_is_active, is_active),
    sort_order = coalesce(p_sort_order, sort_order),
    price = coalesce(p_price, price)
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
      'new_duration_days', coalesce(p_duration_days, v_old.duration_days),
      'old_price', v_old.price,
      'new_price', coalesce(p_price, v_old.price)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- set_block_free_access: year scope on subject.year_id
-- ---------------------------------------------------------------------------
create or replace function public.set_block_free_access(
  p_subject_id uuid,
  p_free_access boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old boolean;
  v_product_key text;
  v_year uuid;
begin
  perform public.require_permission('manage_subscriptions');

  select free_access, product_key, year_id
  into v_old, v_product_key, v_year
  from public.subjects
  where id = p_subject_id;

  if not found then
    raise exception 'subject_not_found';
  end if;
  if v_product_key is null then
    raise exception 'subject_has_no_product_key';
  end if;
  perform public.require_admin_year_scope(v_year);

  update public.subjects set free_access = p_free_access where id = p_subject_id;

  perform public.log_audit(
    'subject_free_access_updated',
    'subject',
    p_subject_id,
    jsonb_build_object(
      'product_key', v_product_key,
      'old_free_access', v_old,
      'new_free_access', p_free_access
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- activate_subscription: year scope + plan.year_id must match subscription year
-- ---------------------------------------------------------------------------
create or replace function public.activate_subscription(
  p_student_id uuid,
  p_plan_id uuid,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_application_id uuid default null,
  p_grace_days int default null,
  p_paid_access_mode text default null,
  p_year_id uuid default null
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
  v_grace int;
  v_mode text;
  v_year uuid;
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
      and public.subscription_is_live_at(status, ends_at, grace_days, now())
  ) then
    raise exception 'subscription_already_active';
  end if;

  if p_year_id is not null then
    select id into v_year from public.years where id = p_year_id;
  elsif p_application_id is not null then
    select year_id into v_year
    from public.subscription_applications
    where id = p_application_id;
  end if;
  if v_year is null then
    select e.year_id into v_year
    from public.enrollments e
    where e.student_id = p_student_id and e.status = 'active';
  end if;
  if v_year is null then
    raise exception 'invalid_year';
  end if;

  perform public.require_admin_year_scope(v_year);

  if v_plan.year_id is distinct from v_year then
    raise exception 'plan_year_mismatch';
  end if;

  v_start := coalesce(p_starts_at, now());
  v_end := coalesce(p_ends_at, v_start + make_interval(days => v_plan.duration_days));
  v_grace := coalesce(p_grace_days, public.tenant_subscription_grace_days());
  if v_grace not in (0, 1, 2) then
    raise exception 'invalid_grace_days';
  end if;
  v_mode := coalesce(nullif(btrim(coalesce(p_paid_access_mode, '')), ''), 'all_entitled');
  if v_mode not in ('all_entitled', 'grants_only') then
    raise exception 'invalid_paid_access_mode';
  end if;
  if v_end <= v_start then
    raise exception 'invalid_subscription_window';
  end if;
  if public.subscription_grace_until(v_end, v_grace) <= now() then
    raise exception 'subscription_already_ended';
  end if;

  insert into public.subscriptions (
    student_id, plan_id, status, starts_at, ends_at, application_id,
    grace_days, paid_access_mode, activated_by, activated_at, year_id
  ) values (
    p_student_id, p_plan_id, 'active', v_start, v_end, p_application_id,
    v_grace, v_mode, (select auth.uid()), now(), v_year
  )
  returning id into v_id;

  if exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.status = 'active'
      and e.year_id is distinct from v_year
  ) then
    perform set_config('medverse.class_change_rpc', '1', true);
    update public.enrollments
    set status = 'expired'
    where student_id = p_student_id and status = 'active';
    insert into public.enrollments (student_id, year_id, status, approved_by, approved_at)
    values (p_student_id, v_year, 'active', (select auth.uid()), now());
    perform set_config('medverse.class_change_rpc', '', true);
  end if;

  perform public.log_audit(
    'subscription_activated',
    'subscription',
    v_id,
    jsonb_build_object(
      'student_id', p_student_id,
      'plan_id', p_plan_id,
      'is_complimentary', v_plan.is_complimentary,
      'year_id', v_year,
      'old_status', null,
      'new_status', 'active'
    )
  );
  return v_id;
exception
  when others then
    perform set_config('medverse.class_change_rpc', '', true);
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lifecycle mutations: year scope on subscription.year_id
-- ---------------------------------------------------------------------------
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
  perform public.require_admin_year_scope(v_row.year_id);
  perform public.expire_due_subscriptions(v_row.student_id);
  select * into v_row from public.subscriptions where id = p_subscription_id;

  if not public.subscription_is_live_at(v_row.status, v_row.ends_at, v_row.grace_days, now()) then
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
  perform public.require_admin_year_scope(v_row.year_id);
  if v_row.status is distinct from 'active' then
    raise exception 'subscription_not_active';
  end if;
  if p_ends_at <= v_row.starts_at then
    raise exception 'invalid_subscription_window';
  end if;

  v_new_status := case
    when public.subscription_grace_until(p_ends_at, v_row.grace_days) <= now()
      then 'expired'
    else 'active'
  end;
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

create or replace function public.set_subscription_access(
  p_subscription_id uuid,
  p_grace_days int default null,
  p_paid_access_mode text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
  v_grace int;
  v_mode text;
begin
  perform public.require_permission('manage_subscriptions');
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  perform public.require_admin_year_scope(v_row.year_id);
  if v_row.status is distinct from 'active' then
    raise exception 'subscription_not_active';
  end if;
  v_grace := coalesce(p_grace_days, v_row.grace_days);
  v_mode := coalesce(nullif(btrim(coalesce(p_paid_access_mode, '')), ''), v_row.paid_access_mode);
  if v_grace not in (0, 1, 2) then
    raise exception 'invalid_grace_days';
  end if;
  if v_mode not in ('all_entitled', 'grants_only') then
    raise exception 'invalid_paid_access_mode';
  end if;
  update public.subscriptions
  set grace_days = v_grace,
      paid_access_mode = v_mode
  where id = p_subscription_id;
  perform public.log_audit(
    'subscription_access_changed',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'old_grace_days', v_row.grace_days,
      'new_grace_days', v_grace,
      'old_paid_access_mode', v_row.paid_access_mode,
      'new_paid_access_mode', v_mode
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
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  perform public.require_admin_year_scope(v_row.year_id);
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
  perform public.require_admin_year_scope(v_row.year_id);
  perform public.expire_due_subscriptions(v_row.student_id);
  select * into v_row from public.subscriptions where id = p_subscription_id;

  if v_row.status is distinct from 'deactivated' then
    raise exception 'subscription_not_deactivated';
  end if;
  if not public.subscription_is_live_at(
    'active', v_row.ends_at, v_row.grace_days, now()
  ) then
    raise exception 'subscription_already_ended';
  end if;
  if exists (
    select 1 from public.subscriptions
    where student_id = v_row.student_id
      and public.subscription_is_live_at(status, ends_at, grace_days, now())
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
      'new_status', 'active'
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
  perform public.require_admin_year_scope(v_row.year_id);
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
  if v_plan.year_id is distinct from v_row.year_id then
    raise exception 'plan_year_mismatch';
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

-- ---------------------------------------------------------------------------
-- Application review RPCs: year scope
-- ---------------------------------------------------------------------------
create or replace function public.approve_subscription_application(
  p_application_id uuid,
  p_review_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscription_applications%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_live uuid;
  v_sub uuid;
  v_claimed int;
begin
  perform public.require_permission('review_subscription_applications');
  perform public.require_permission('manage_subscriptions');

  select * into v_row
  from public.subscription_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'application_not_found';
  end if;

  perform public.require_admin_year_scope(v_row.year_id);

  if v_row.plan_id is null then
    raise exception 'plan_required';
  end if;

  select * into v_plan from public.subscription_plans where id = v_row.plan_id;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if not v_plan.is_active then
    raise exception 'plan_inactive';
  end if;
  if v_plan.year_id is distinct from v_row.year_id then
    raise exception 'plan_year_mismatch';
  end if;

  perform set_config('medverse.subscription_application_rpc', '1', true);
  update public.subscription_applications
  set
    status = 'approved',
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    review_note = p_review_note
  where id = p_application_id
    and status = 'pending';
  get diagnostics v_claimed = row_count;
  perform set_config('medverse.subscription_application_rpc', '', true);

  if v_claimed <> 1 then
    raise exception 'application_not_pending';
  end if;

  perform public.expire_due_subscriptions(v_row.student_id);

  select id into v_live
  from public.subscriptions
  where student_id = v_row.student_id
    and public.subscription_is_live_at(status, ends_at, grace_days, now())
  order by ends_at desc
  limit 1
  for update;

  if v_live is not null then
    perform public.extend_subscription(v_live, null);
    update public.subscriptions
    set application_id = p_application_id,
        year_id = v_row.year_id
    where id = v_live;
    if exists (
      select 1 from public.subscriptions
      where id = v_live and plan_id is distinct from v_row.plan_id
    ) then
      perform public.assign_subscription_plan(v_live, v_row.plan_id);
    end if;
    v_sub := v_live;
  else
    v_sub := public.activate_subscription(
      v_row.student_id,
      v_row.plan_id,
      null,
      null,
      p_application_id,
      null,
      null,
      v_row.year_id
    );
  end if;

  insert into public.student_notifications (student_id, kind, ref_id, payload)
  values (
    v_row.student_id,
    'application_approved',
    p_application_id,
    jsonb_build_object(
      'plan_name', v_plan.name,
      'subscription_id', v_sub,
      'amount', v_row.amount,
      'currency', v_row.currency
    )
  )
  on conflict (student_id, kind, ref_id) do update
    set payload = excluded.payload,
        read_at = null,
        created_at = now();

  perform public.log_audit(
    'subscription_application_approved',
    'subscription_application',
    p_application_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'subscription_id', v_sub,
      'year_id', v_row.year_id,
      'amount', v_row.amount,
      'currency', v_row.currency,
      'old_status', 'pending',
      'new_status', 'approved',
      'review_note', p_review_note
    )
  );
  return v_sub;
exception
  when others then
    perform set_config('medverse.subscription_application_rpc', '', true);
    raise;
end;
$$;

create or replace function public.reject_subscription_application(
  p_application_id uuid,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscription_applications%rowtype;
begin
  perform public.require_permission('review_subscription_applications');
  select * into v_row from public.subscription_applications where id = p_application_id;
  if not found then
    raise exception 'application_not_found';
  end if;
  perform public.require_admin_year_scope(v_row.year_id);
  if v_row.status is distinct from 'pending' then
    raise exception 'application_not_pending';
  end if;

  perform set_config('medverse.subscription_application_rpc', '1', true);
  update public.subscription_applications
  set
    status = 'rejected',
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    review_note = p_review_note
  where id = p_application_id
    and status = 'pending';
  perform set_config('medverse.subscription_application_rpc', '', true);

  insert into public.student_notifications (student_id, kind, ref_id, payload)
  values (
    v_row.student_id,
    'application_rejected',
    p_application_id,
    jsonb_build_object(
      'review_note', p_review_note,
      'amount', v_row.amount,
      'currency', v_row.currency
    )
  )
  on conflict (student_id, kind, ref_id) do update
    set payload = excluded.payload,
        read_at = null,
        created_at = now();

  perform public.log_audit(
    'subscription_application_rejected',
    'subscription_application',
    p_application_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'old_status', 'pending',
      'new_status', 'rejected',
      'review_note', p_review_note
    )
  );
end;
$$;

create or replace function public.authorize_payment_screenshot_access(
  p_application_id uuid,
  p_purpose text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.subscription_applications%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_purpose is null or p_purpose not in ('read', 'write') then
    raise exception 'invalid_screenshot_purpose';
  end if;

  select * into v_row
  from public.subscription_applications
  where id = p_application_id;
  if not found then
    raise exception 'screenshot_access_denied';
  end if;

  if p_purpose = 'write' then
    if v_row.student_id is distinct from v_uid
       or v_row.status is distinct from 'pending'
       or not public.account_allows_lms() then
      raise exception 'screenshot_access_denied';
    end if;
    return v_row.screenshot_object_key;
  end if;

  if v_row.student_id = v_uid and v_row.status = 'pending' then
    return v_row.screenshot_object_key;
  end if;
  if public.has_permission('review_subscription_applications')
     and public.admin_can_access_year(v_row.year_id) then
    return v_row.screenshot_object_key;
  end if;
  raise exception 'screenshot_access_denied';
end;
$$;

-- ---------------------------------------------------------------------------
-- Class switch / promote: year scope on from + to years
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
  v_live public.subscriptions%rowtype;
  v_new_plan uuid;
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

  perform public.require_admin_year_scope(v_current.year_id);
  perform public.require_admin_year_scope(v_row.to_year_id);

  select * into v_live
  from public.subscriptions s
  where s.student_id = v_row.student_id
    and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now())
  for update;
  if found then
    v_new_plan := public.resolve_destination_subscription_plan_id(
      v_live.plan_id,
      v_row.to_year_id
    );
  end if;

  v_note := nullif(btrim(coalesce(p_review_note, '')), '');

  perform set_config('medverse.class_change_rpc', '1', true);

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

  if v_live.id is not null then
    update public.subscriptions
    set
      year_id = v_row.to_year_id,
      plan_id = v_new_plan
    where id = v_live.id;
  end if;

  perform set_config('medverse.class_change_rpc', '', true);

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
      'review_note', v_note,
      'subscription_year_synced', true,
      'subscription_plan_synced', v_live.id is not null,
      'old_plan_id', v_live.plan_id,
      'new_plan_id', v_new_plan
    )
  );

  return v_new_id;
exception
  when others then
    perform set_config('medverse.class_change_rpc', '', true);
    perform set_config('medverse.year_change_request_rpc', '', true);
    raise;
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
  v_live public.subscriptions%rowtype;
  v_new_plan uuid;
begin
  perform public.require_permission('manage_year_changes');

  select * into v_current from public.enrollments
  where student_id = p_student_id and status = 'active'
  for update;
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

  perform public.require_admin_year_scope(v_current.year_id);
  perform public.require_admin_year_scope(v_next_year);

  select * into v_live
  from public.subscriptions s
  where s.student_id = p_student_id
    and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now())
  for update;
  if found then
    v_new_plan := public.resolve_destination_subscription_plan_id(
      v_live.plan_id,
      v_next_year
    );
  end if;

  perform set_config('medverse.class_change_rpc', '1', true);

  update public.enrollments set status = 'expired' where id = v_current.id;
  insert into public.enrollments (student_id, year_id, status, approved_by, approved_at)
  values (p_student_id, v_next_year, 'active', (select auth.uid()), now())
  returning id into v_new_id;

  if v_live.id is not null then
    update public.subscriptions
    set
      year_id = v_next_year,
      plan_id = v_new_plan
    where id = v_live.id;
  end if;

  perform set_config('medverse.class_change_rpc', '', true);

  perform public.log_audit('student_promoted', 'enrollment', v_new_id,
    jsonb_build_object(
      'student_id', p_student_id,
      'from_year', v_current.year_id,
      'to_year', v_next_year,
      'subscription_year_synced', true,
      'subscription_plan_synced', v_live.id is not null,
      'old_plan_id', v_live.plan_id,
      'new_plan_id', v_new_plan
    ));
  return v_new_id;
exception
  when others then
    perform set_config('medverse.class_change_rpc', '', true);
    raise;
end;
$$;
