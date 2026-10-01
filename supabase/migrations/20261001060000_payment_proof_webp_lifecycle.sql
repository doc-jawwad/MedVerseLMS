-- Payment-proof WebP lifecycle: nullable screenshot key after subscription end,
-- enqueue payment-proofs/ via shared R2 purge queue, release on expire/deactivate.

-- ---------------------------------------------------------------------------
-- screenshot_object_key may be cleared after subscription end (history row kept)
-- ---------------------------------------------------------------------------
alter table public.subscription_applications
  alter column screenshot_object_key drop not null;

comment on column public.subscription_applications.screenshot_object_key is
  'Private R2 key payment-proofs/{tenant}/{student}/{uuid} for the canonical optimized WebP. Null after linked subscription ends (expired/deactivated) and the object was released to r2_purge_queue. Pending create/update RPCs still require a non-null key.';

-- ---------------------------------------------------------------------------
-- r2_purge_queue: allow study-content/ and payment-proofs/
-- ---------------------------------------------------------------------------
alter table public.r2_purge_queue
  drop constraint if exists r2_purge_queue_object_key_check;

alter table public.r2_purge_queue
  add constraint r2_purge_queue_object_key_check
  check (
    object_key !~ '[[:space:]]'
    and (
      object_key ~ '^study-content/'
      or object_key ~ '^payment-proofs/'
    )
  );

-- ---------------------------------------------------------------------------
-- enqueue_r2_purge: allow study-content/ and payment-proofs/
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_r2_purge(
  p_object_key text,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_object_key is null
     or p_object_key ~ '[[:space:]]'
     or p_object_key ~ '://'
     or not (
       p_object_key like 'study-content/%'
       or p_object_key like 'payment-proofs/%'
     ) then
    return;
  end if;

  insert into public.r2_purge_queue (object_key, entity_type, entity_id)
  values (p_object_key, p_entity_type, p_entity_id)
  on conflict (object_key) where completed_at is null
  do nothing;
exception
  when unique_violation then
    null;
end;
$$;

comment on function public.enqueue_r2_purge(text, text, uuid) is
  'Enqueue R2 object for deferred delete. Accepts study-content/ and payment-proofs/ only.';

-- ---------------------------------------------------------------------------
-- Release proof for a subscription that has ended (expired or deactivated)
-- ---------------------------------------------------------------------------
create or replace function public.release_subscription_payment_proof(
  p_subscription_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_app_id uuid;
  v_key text;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id;
  if not found then
    return;
  end if;

  -- Only release when the subscription is no longer live.
  if public.subscription_is_live_at(
    v_sub.status, v_sub.ends_at, v_sub.grace_days, now()
  ) then
    return;
  end if;

  v_app_id := v_sub.application_id;
  if v_app_id is null then
    return;
  end if;

  -- Another live subscription still bound to this application must keep the proof.
  if exists (
    select 1 from public.subscriptions s
    where s.application_id = v_app_id
      and s.id is distinct from p_subscription_id
      and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now())
  ) then
    return;
  end if;

  select screenshot_object_key into v_key
  from public.subscription_applications
  where id = v_app_id
  for update;

  if v_key is null or v_key = '' then
    return;
  end if;

  -- Clear the operational reference first so refcount can drop to zero.
  perform set_config('medverse.subscription_application_rpc', '1', true);
  update public.subscription_applications
  set screenshot_object_key = null,
      updated_at = now()
  where id = v_app_id
    and screenshot_object_key is not distinct from v_key;
  perform set_config('medverse.subscription_application_rpc', '', true);

  -- Shared-key safe: enqueue only when no remaining DB reference.
  perform public.enqueue_r2_purge_if_unreferenced(
    v_key,
    'subscription_application',
    v_app_id
  );
exception
  when others then
    perform set_config('medverse.subscription_application_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.release_subscription_payment_proof(uuid)
  from public, anon, authenticated;
grant execute on function public.release_subscription_payment_proof(uuid)
  to service_role;

comment on function public.release_subscription_payment_proof(uuid) is
  'After a subscription ends (expired/deactivated): clear application screenshot_object_key and enqueue payment-proof R2 purge if unreferenced. Preserves application/subscription history rows.';

-- ---------------------------------------------------------------------------
-- expire_due_subscriptions: release proofs for newly expired rows
-- ---------------------------------------------------------------------------
create or replace function public.expire_due_subscriptions(p_student_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid := p_student_id;
  v_count int := 0;
  r record;
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

  perform public.emit_subscription_expiry_warnings(v_student);

  for r in
    update public.subscriptions
    set status = 'expired'
    where status = 'active'
      and public.subscription_grace_until(ends_at, grace_days) <= now()
      and (v_student is null or student_id = v_student)
    returning id
  loop
    perform public.release_subscription_payment_proof(r.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- deactivate_subscription: immediate admin cancel → release proof
-- ---------------------------------------------------------------------------
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

  perform public.release_subscription_payment_proof(p_subscription_id);

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

-- ---------------------------------------------------------------------------
-- set_subscription_end: release when window ends immediately
-- ---------------------------------------------------------------------------
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

  if v_new_status = 'expired' then
    perform public.release_subscription_payment_proof(p_subscription_id);
  end if;

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

-- ---------------------------------------------------------------------------
-- authorize_payment_screenshot_access: refuse cleared (null) keys
-- ---------------------------------------------------------------------------
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
  if v_row.screenshot_object_key is null or v_row.screenshot_object_key = '' then
    raise exception 'screenshot_not_available';
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
