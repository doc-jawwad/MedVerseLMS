-- Class-switch / promote: keep subscriptions.plan_id coherent with
-- subscriptions.year_id. Remap plan_id to an active destination-year plan
-- (prefer matching is_complimentary; then sort_order, name). Preserve
-- starts_at/ends_at. Fail with destination_plan_unavailable before mutating
-- enrollment if no destination plan exists. assign_subscription_plan rejects
-- cross-year plans. Does not change has_live_subscription / has_live_plan.

-- ---------------------------------------------------------------------------
-- resolve_destination_subscription_plan_id
-- ---------------------------------------------------------------------------
create or replace function public.resolve_destination_subscription_plan_id(
  p_current_plan_id uuid,
  p_destination_year_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_complimentary boolean;
  v_plan_id uuid;
begin
  if p_destination_year_id is null then
    raise exception 'invalid_year';
  end if;
  if not exists (select 1 from public.years where id = p_destination_year_id) then
    raise exception 'year_not_found';
  end if;

  select is_complimentary into v_complimentary
  from public.subscription_plans
  where id = p_current_plan_id;

  if v_complimentary is null then
    v_complimentary := false;
  end if;

  select sp.id into v_plan_id
  from public.subscription_plans sp
  where sp.year_id = p_destination_year_id
    and sp.is_active
    and sp.is_complimentary = v_complimentary
  order by sp.sort_order, sp.name
  limit 1;

  if v_plan_id is null then
    select sp.id into v_plan_id
    from public.subscription_plans sp
    where sp.year_id = p_destination_year_id
      and sp.is_active
    order by sp.sort_order, sp.name
    limit 1;
  end if;

  if v_plan_id is null then
    raise exception 'destination_plan_unavailable';
  end if;

  return v_plan_id;
end;
$$;

comment on function public.resolve_destination_subscription_plan_id(uuid, uuid) is
  'Pick active destination-year plan for class switch/promote: prefer same is_complimentary, then sort_order, name.';

revoke execute on function public.resolve_destination_subscription_plan_id(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_destination_subscription_plan_id(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- approve_year_change_request: sync year_id + plan_id atomically
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

  -- Resolve destination plan BEFORE enrollment mutation so failure leaves
  -- enrollment/subscription unchanged.
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

-- ---------------------------------------------------------------------------
-- promote_student: same year_id + plan_id coherence
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- assign_subscription_plan: reject cross-year plan
-- ---------------------------------------------------------------------------
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
