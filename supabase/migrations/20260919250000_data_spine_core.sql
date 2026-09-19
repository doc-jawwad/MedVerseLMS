-- Data Spine core (schema-lane): class lock, profile college/avatar keys,
-- subscription/application year_id. Canonical:
-- docs/architecture.md Product structure freeze, docs/database.md,
-- docs/permissions.md. Does NOT remap subjects→Blocks (controlled mapping
-- deferred — see migration comment at bottom). Does NOT touch test_attempts,
-- rank_test, or exam state machine.

-- ---------------------------------------------------------------------------
-- profiles: college + private avatar object key
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists college_name text;

alter table public.profiles
  add column if not exists avatar_object_key text;

alter table public.profiles
  drop constraint if exists profiles_avatar_object_key_check;

alter table public.profiles
  add constraint profiles_avatar_object_key_check
  check (
    avatar_object_key is null
    or avatar_object_key ~ '^study-content/avatars/'
  );

comment on column public.profiles.college_name is
  'Optional college for profile + leaderboard projection. Never email/phone.';
comment on column public.profiles.avatar_object_key is
  'Private R2 key under study-content/avatars/. Signed via authorize_avatar_object; never public URL.';

-- ---------------------------------------------------------------------------
-- subscriptions.year_id + subscription_applications.year_id
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists year_id uuid references public.years (id);

alter table public.subscription_applications
  add column if not exists year_id uuid references public.years (id);

-- Backfill from active enrollment (best available purchase/class proxy).
update public.subscriptions s
set year_id = e.year_id
from public.enrollments e
where s.year_id is null
  and e.student_id = s.student_id
  and e.status = 'active';

update public.subscription_applications a
set year_id = e.year_id
from public.enrollments e
where a.year_id is null
  and e.student_id = a.student_id
  and e.status = 'active';

-- Remaining orphans: attach year 1 so NOT NULL can apply (should be rare).
update public.subscriptions
set year_id = (select id from public.years where year_number = 1 limit 1)
where year_id is null;

update public.subscription_applications
set year_id = (select id from public.years where year_number = 1 limit 1)
where year_id is null;

alter table public.subscriptions
  alter column year_id set not null;

alter table public.subscription_applications
  alter column year_id set not null;

create index if not exists subscriptions_year_idx
  on public.subscriptions (year_id);

create index if not exists subscription_applications_year_idx
  on public.subscription_applications (year_id);

comment on column public.subscriptions.year_id is
  'Purchased / locked class. Live subscription locks student class to this year.';
comment on column public.subscription_applications.year_id is
  'Selected purchase class at apply time. Pending application locks class.';

-- ---------------------------------------------------------------------------
-- Enrollment trigger: allow free self-serve class change via GUC
-- ---------------------------------------------------------------------------
create or replace function public.protect_enrollment_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('medverse.class_change_rpc', true) = '1' then
    return new;
  end if;
  if current_setting('medverse.year_change_request_rpc', true) = '1' then
    return new;
  end if;
  if tg_op = 'update'
     and (select auth.uid()) is not null
     and not public.has_permission('manage_year_changes')
     and (
       new.year_id is distinct from old.year_id
       or new.student_id is distinct from old.student_id
       or new.status is distinct from old.status
     ) then
    if not public.is_admin() then
      raise exception 'students cannot change class assignment';
    else
      raise exception 'permission_denied';
    end if;
  end if;
  if tg_op = 'insert'
     and (select auth.uid()) is not null
     and not public.has_permission('manage_year_changes')
     and not public.is_admin()
     and current_setting('medverse.class_change_rpc', true) is distinct from '1'
     and current_setting('medverse.ensure_profile_rpc', true) is distinct from '1' then
    -- Student INSERT only via ensure_profile / class-change RPCs (definer + GUC).
    -- Definer RPCs still set auth.uid(); allow admin/manage_year_changes path.
    null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Class lock helpers + RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_class_lock_state()
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
  v_sub_year uuid;
  v_pending_id uuid;
  v_lock text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select e.year_id, y.year_number, y.name
  into v_year_id, v_year_number, v_year_name
  from public.enrollments e
  join public.years y on y.id = e.year_id
  where e.student_id = v_uid and e.status = 'active';

  if v_year_id is null then
    raise exception 'no_active_enrollment';
  end if;

  select s.year_id into v_sub_year
  from public.subscriptions s
  where s.student_id = v_uid
    and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now())
  order by s.ends_at desc
  limit 1;

  select a.id into v_pending_id
  from public.subscription_applications a
  where a.student_id = v_uid and a.status = 'pending'
  limit 1;

  if v_sub_year is not null then
    v_lock := 'active_subscription';
  elsif v_pending_id is not null then
    v_lock := 'pending_application';
  else
    v_lock := 'free';
  end if;

  return jsonb_build_object(
    'year_id', v_year_id,
    'year_number', v_year_number,
    'year_name', case
      when v_year_number = 5 then 'Final Year MBBS'
      else v_year_name
    end,
    'lock', v_lock,
    'can_self_change', v_lock = 'free',
    'subscription_year_id', v_sub_year,
    'pending_application_id', v_pending_id
  );
end;
$$;

revoke execute on function public.get_class_lock_state() from public, anon;
grant execute on function public.get_class_lock_state() to authenticated, service_role;

create or replace function public.self_change_class(p_year_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lock jsonb;
  v_current public.enrollments%rowtype;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  v_lock := public.get_class_lock_state();
  if (v_lock->>'lock') is distinct from 'free' then
    raise exception 'class_locked';
  end if;

  if not exists (select 1 from public.years where id = p_year_id) then
    raise exception 'invalid_year';
  end if;

  select * into v_current
  from public.enrollments
  where student_id = v_uid and status = 'active'
  for update;

  if not found then
    raise exception 'no_active_enrollment';
  end if;

  if v_current.year_id = p_year_id then
    return jsonb_build_object('ok', true, 'year_id', p_year_id);
  end if;

  perform set_config('medverse.class_change_rpc', '1', true);

  update public.enrollments
  set status = 'expired'
  where id = v_current.id;

  insert into public.enrollments (student_id, year_id, status)
  values (v_uid, p_year_id, 'active')
  returning id into v_new_id;

  perform set_config('medverse.class_change_rpc', '', true);

  return jsonb_build_object('ok', true, 'year_id', p_year_id);
exception
  when others then
    perform set_config('medverse.class_change_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.self_change_class(uuid) from public, anon;
grant execute on function public.self_change_class(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Year-change requests: locked path only (pending/live subscription)
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
  v_lock text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  v_lock := public.get_class_lock_state()->>'lock';
  if v_lock = 'free' then
    raise exception 'use_self_change_class';
  end if;

  select e.year_id into v_from
  from public.enrollments e
  where e.student_id = v_uid and e.status = 'active';
  if v_from is null then
    raise exception 'no_active_enrollment';
  end if;

  select y.id into v_to from public.years y where y.id = p_to_year_id;
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

-- ---------------------------------------------------------------------------
-- Approve year change: sync live subscriptions.year_id
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

  -- Keep live subscription class in sync (SPEC FREEZE).
  update public.subscriptions s
  set year_id = v_row.to_year_id
  where s.student_id = v_row.student_id
    and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now());

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
      'subscription_year_synced', true
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
-- promote_student: sync subscriptions.year_id; keep manage_year_changes gate
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

  perform set_config('medverse.class_change_rpc', '1', true);

  update public.enrollments set status = 'expired' where id = v_current.id;
  insert into public.enrollments (student_id, year_id, status, approved_by, approved_at)
  values (p_student_id, v_next_year, 'active', (select auth.uid()), now())
  returning id into v_new_id;

  update public.subscriptions s
  set year_id = v_next_year
  where s.student_id = p_student_id
    and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now());

  perform set_config('medverse.class_change_rpc', '', true);

  perform public.log_audit('student_promoted', 'enrollment', v_new_id,
    jsonb_build_object(
      'student_id', p_student_id,
      'from_year', v_current.year_id,
      'to_year', v_next_year,
      'subscription_year_synced', true
    ));
  return v_new_id;
exception
  when others then
    perform set_config('medverse.class_change_rpc', '', true);
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Subscription application: require / store purchase year_id
-- ---------------------------------------------------------------------------
drop function if exists public.create_subscription_application(numeric, text, uuid, text);

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
  v_plan := public.resolve_application_plan_id(p_plan_id);
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

drop function if exists public.update_pending_subscription_application(uuid, numeric, text, uuid, text);

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
  v_plan := case
    when p_plan_id is null then v_row.plan_id
    else public.resolve_application_plan_id(p_plan_id)
  end;
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

-- ---------------------------------------------------------------------------
-- activate_subscription: set year_id (from arg, application, or enrollment)
-- ---------------------------------------------------------------------------
drop function if exists public.activate_subscription(
  uuid, uuid, timestamptz, timestamptz, uuid, int, text
);

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

  -- Align enrollment to purchased class when approving a different year.
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

revoke execute on function public.activate_subscription(
  uuid, uuid, timestamptz, timestamptz, uuid, int, text, uuid
) from public, anon;
grant execute on function public.activate_subscription(
  uuid, uuid, timestamptz, timestamptz, uuid, int, text, uuid
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- approve_subscription_application: copy year_id → subscription + enrollment
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
  if v_row.status is distinct from 'pending' then
    raise exception 'application_not_pending';
  end if;
  if v_row.plan_id is null then
    raise exception 'plan_required';
  end if;
  if v_row.year_id is null then
    raise exception 'invalid_year';
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

  -- Align enrollment to purchase class if still mismatched (extend path).
  if exists (
    select 1 from public.enrollments e
    where e.student_id = v_row.student_id and e.status = 'active'
      and e.year_id is distinct from v_row.year_id
  ) then
    perform set_config('medverse.class_change_rpc', '1', true);
    update public.enrollments
    set status = 'expired'
    where student_id = v_row.student_id and status = 'active';
    insert into public.enrollments (student_id, year_id, status, approved_by, approved_at)
    values (v_row.student_id, v_row.year_id, 'active', (select auth.uid()), now());
    perform set_config('medverse.class_change_rpc', '', true);
  end if;

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
    perform set_config('medverse.class_change_rpc', '', true);
    raise;
end;
$$;

comment on function public.get_class_lock_state() is
  'Returns free | pending_application | active_subscription class-lock state for caller.';
comment on function public.self_change_class(uuid) is
  'Free-student self-serve class change. Rejects when pending application or live subscription.';

-- Architectural note (compatibility): subjects remain departmental until a
-- separate controlled Blocks mapping migration. Do not mass-rename here.
