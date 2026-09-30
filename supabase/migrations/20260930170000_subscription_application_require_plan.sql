-- Require explicit class-scoped plan_id on student subscription applications.
-- Replaces resolve_application_plan_id's single-global-plan fallback with
-- enrollment + year + active-plan validation. Does not change amount semantics
-- (submitted transfer amount stays authoritative) or the payment-proof flow.

-- ---------------------------------------------------------------------------
-- resolve_application_plan_id(plan, year): explicit plan only; no auto-pick
-- ---------------------------------------------------------------------------
drop function if exists public.resolve_application_plan_id(uuid);

create or replace function public.resolve_application_plan_id(
  p_plan_id uuid,
  p_year_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans%rowtype;
begin
  if p_plan_id is null then
    raise exception 'plan_required';
  end if;
  if p_year_id is null then
    raise exception 'invalid_year';
  end if;

  -- Student must be enrolled in the application / purchase class.
  if not exists (
    select 1
    from public.enrollments e
    where e.student_id = (select auth.uid())
      and e.year_id = p_year_id
      and e.status = 'active'
  ) then
    raise exception 'year_access_denied';
  end if;

  select * into v_plan
  from public.subscription_plans
  where id = p_plan_id;

  if not found then
    raise exception 'plan_not_found';
  end if;
  if not v_plan.is_active then
    raise exception 'plan_inactive';
  end if;
  if v_plan.year_id is distinct from p_year_id then
    raise exception 'plan_year_mismatch';
  end if;

  return v_plan.id;
end;
$$;

revoke execute on function public.resolve_application_plan_id(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_application_plan_id(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- create_subscription_application: require + validate plan against year
-- ---------------------------------------------------------------------------
create or replace function public.create_subscription_application(
  p_amount numeric,
  p_screenshot_object_key text,
  p_plan_id uuid default null,
  p_currency text default null,
  p_year_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_plan uuid;
  v_currency text;
  v_year uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  perform public.assert_own_screenshot_object_key(v_uid, p_screenshot_object_key);
  v_currency := public.resolve_application_currency(p_currency);

  if p_year_id is not null then
    select id into v_year from public.years where id = p_year_id;
    if v_year is null then
      raise exception 'invalid_year';
    end if;
  else
    select e.year_id into v_year
    from public.enrollments e
    where e.student_id = v_uid and e.status = 'active';
    if v_year is null then
      raise exception 'no_active_enrollment';
    end if;
  end if;

  -- Requires explicit p_plan_id; verifies enrollment, active plan, year match.
  v_plan := public.resolve_application_plan_id(p_plan_id, v_year);

  if exists (
    select 1 from public.subscription_applications
    where student_id = v_uid and status = 'pending'
  ) then
    raise exception 'application_already_pending';
  end if;

  perform set_config('medverse.subscription_application_rpc', '1', true);
  insert into public.subscription_applications (
    student_id, plan_id, amount, currency, screenshot_object_key, status, year_id
  ) values (
    v_uid, v_plan, p_amount, v_currency, p_screenshot_object_key, 'pending', v_year
  )
  returning id into v_id;
  perform set_config('medverse.subscription_application_rpc', '', true);
  return v_id;
exception
  when others then
    perform set_config('medverse.subscription_application_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.create_subscription_application(numeric, text, uuid, text, uuid)
  from public, anon;
grant execute on function public.create_subscription_application(numeric, text, uuid, text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_pending_subscription_application: same plan/year enrollment guards
-- ---------------------------------------------------------------------------
create or replace function public.update_pending_subscription_application(
  p_application_id uuid,
  p_amount numeric default null,
  p_screenshot_object_key text default null,
  p_plan_id uuid default null,
  p_currency text default null,
  p_year_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.subscription_applications%rowtype;
  v_plan uuid;
  v_currency text;
  v_key text;
  v_year uuid;
  v_plan_input uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select * into v_row
  from public.subscription_applications
  where id = p_application_id;
  if not found then
    raise exception 'application_not_found';
  end if;
  if v_row.student_id is distinct from v_uid then
    raise exception 'application_not_found';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'application_not_pending';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  v_key := coalesce(p_screenshot_object_key, v_row.screenshot_object_key);
  perform public.assert_own_screenshot_object_key(v_uid, v_key);
  v_currency := case
    when p_currency is null then v_row.currency
    else public.resolve_application_currency(p_currency)
  end;

  if p_year_id is null then
    v_year := v_row.year_id;
  else
    select id into v_year from public.years where id = p_year_id;
    if v_year is null then
      raise exception 'invalid_year';
    end if;
  end if;

  -- Explicit plan when provided; otherwise re-validate the stored plan against
  -- the (possibly updated) purchase year. Never auto-pick a global plan.
  v_plan_input := coalesce(p_plan_id, v_row.plan_id);
  v_plan := public.resolve_application_plan_id(v_plan_input, v_year);

  perform set_config('medverse.subscription_application_rpc', '1', true);
  update public.subscription_applications
  set
    amount = coalesce(p_amount, amount),
    screenshot_object_key = v_key,
    plan_id = v_plan,
    currency = v_currency,
    year_id = v_year
  where id = p_application_id
    and status = 'pending'
    and student_id = v_uid;
  perform set_config('medverse.subscription_application_rpc', '', true);
end;
$$;

revoke execute on function public.update_pending_subscription_application(uuid, numeric, text, uuid, text, uuid)
  from public, anon;
grant execute on function public.update_pending_subscription_application(uuid, numeric, text, uuid, text, uuid)
  to authenticated, service_role;
