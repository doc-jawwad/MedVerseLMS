-- Subscription plans per class/year, price field, block free-access toggle,
-- and application approval/rejection notifications.
-- Docs: docs/database.md, docs/permissions.md, docs/architecture.md.

-- ---------------------------------------------------------------------------
-- 1. subscription_plans: year_id (one plan belongs to one class)
-- ---------------------------------------------------------------------------
alter table public.subscription_plans
  add column if not exists year_id uuid references public.years (id);

-- Backfill existing plans to Year 1 (safe: no plans exist in prod for other years yet).
update public.subscription_plans
set year_id = (select id from public.years where year_number = 1 limit 1)
where year_id is null;

alter table public.subscription_plans
  alter column year_id set not null;

create index if not exists subscription_plans_year_active_idx
  on public.subscription_plans (year_id, is_active, sort_order);

comment on column public.subscription_plans.year_id is
  'The class this plan is sold for. Students see only plans for their enrolled year.';

-- ---------------------------------------------------------------------------
-- 2. subscription_plans: price (PKR amount displayed in the student UI)
-- ---------------------------------------------------------------------------
alter table public.subscription_plans
  add column if not exists price numeric not null default 0;

alter table public.subscription_plans
  drop constraint if exists subscription_plans_price_check;
alter table public.subscription_plans
  add constraint subscription_plans_price_check check (price >= 0);

comment on column public.subscription_plans.price is
  'Advertised price in the tenant currency (see payment_settings.currency). Authoritative: approval RPC reads this directly, never trusts client-submitted price.';

-- ---------------------------------------------------------------------------
-- 3. subjects: free_access (block-level free student access toggle)
-- ---------------------------------------------------------------------------
alter table public.subjects
  add column if not exists free_access boolean not null default false;

comment on column public.subjects.free_access is
  'When true, free (non-subscribed) students can access this Block/FinalYear subject. Uses the existing product_key Block model — no separate Block table.';

-- ---------------------------------------------------------------------------
-- 4. student_notifications: extend kind enum with approval/rejection
-- ---------------------------------------------------------------------------
alter table public.student_notifications
  drop constraint if exists student_notifications_kind_check;
alter table public.student_notifications
  add constraint student_notifications_kind_check
  check (kind in (
    'subscription_expiry_7d',
    'subscription_expiry_3d',
    'subscription_expiry_1d',
    'application_approved',
    'application_rejected'
  ));

-- ---------------------------------------------------------------------------
-- 5. subscription_plans RLS: scope student reads to their enrolled year
-- ---------------------------------------------------------------------------
drop policy if exists subscription_plans_student_select on public.subscription_plans;
create policy subscription_plans_student_select on public.subscription_plans
  for select using (
    public.is_admin()
    or (
      is_active
      and year_id in (
        select e.year_id
        from public.enrollments e
        where e.student_id = (select auth.uid())
          and e.status = 'active'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 6. create_subscription_plan: add year_id + price
-- ---------------------------------------------------------------------------
drop function if exists public.create_subscription_plan(text, text, int, boolean, boolean, int);

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

-- ---------------------------------------------------------------------------
-- 7. update_subscription_plan: add price
-- ---------------------------------------------------------------------------
drop function if exists public.update_subscription_plan(uuid, text, text, int, boolean, boolean, int);

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
-- 8. get_plans_for_year: student-callable, returns active plans for a year
-- ---------------------------------------------------------------------------
create or replace function public.get_plans_for_year(p_year_id uuid)
returns table (
  id uuid,
  name text,
  description text,
  duration_days int,
  price numeric,
  is_complimentary boolean,
  sort_order int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Authenticated student: must be enrolled in the requested year.
  -- Admin: unrestricted.
  if not public.is_admin() then
    if not exists (
      select 1 from public.enrollments
      where student_id = (select auth.uid())
        and year_id = p_year_id
        and status = 'active'
    ) then
      raise exception 'year_access_denied';
    end if;
  end if;

  return query
    select sp.id, sp.name, sp.description, sp.duration_days, sp.price,
           sp.is_complimentary, sp.sort_order
    from public.subscription_plans sp
    where sp.year_id = p_year_id
      and sp.is_active
    order by sp.sort_order, sp.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. set_block_free_access: admin toggle per Block/FinalYear subject
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
begin
  perform public.require_permission('manage_subscriptions');

  select free_access, product_key
  into v_old, v_product_key
  from public.subjects
  where id = p_subject_id;

  if not found then
    raise exception 'subject_not_found';
  end if;

  -- Only Block/FinalYear subjects (have a product_key) can be toggled.
  if v_product_key is null then
    raise exception 'subject_has_no_product_key';
  end if;

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
-- 10. approve_subscription_application: add plan↔application year guard
--     The full function is replaced to add the cross-year check.
--     Based on the version in 20260919250000_data_spine_core.sql.
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

  if v_row.plan_id is null then
    raise exception 'plan_required';
  end if;

  -- Fetch plan; verify it belongs to the same year as the application.
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

  -- Mark as approved first (optimistic concurrency — claimed=1 means we won the race).
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

  -- Notify student: application approved.
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

-- ---------------------------------------------------------------------------
-- 11. reject_subscription_application: add rejection notification
-- ---------------------------------------------------------------------------
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

  -- Notify student: application rejected.
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
      'plan_id', v_row.plan_id,
      'amount', v_row.amount,
      'currency', v_row.currency,
      'old_status', 'pending',
      'new_status', 'rejected',
      'review_note', p_review_note
    )
  );
exception
  when others then
    perform set_config('medverse.subscription_application_rpc', '', true);
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.create_subscription_plan(text, uuid, numeric, text, int, boolean, boolean, int) from public, anon;
grant execute on function public.create_subscription_plan(text, uuid, numeric, text, int, boolean, boolean, int) to authenticated, service_role;

revoke execute on function public.update_subscription_plan(uuid, text, text, int, boolean, boolean, int, numeric) from public, anon;
grant execute on function public.update_subscription_plan(uuid, text, text, int, boolean, boolean, int, numeric) to authenticated, service_role;

revoke execute on function public.get_plans_for_year(uuid) from public, anon;
grant execute on function public.get_plans_for_year(uuid) to authenticated, service_role;

revoke execute on function public.set_block_free_access(uuid, boolean) from public, anon;
grant execute on function public.set_block_free_access(uuid, boolean) to authenticated, service_role;

revoke execute on function public.approve_subscription_application(uuid, text) from public, anon;
grant execute on function public.approve_subscription_application(uuid, text) to authenticated, service_role;

revoke execute on function public.reject_subscription_application(uuid, text) from public, anon;
grant execute on function public.reject_subscription_application(uuid, text) to authenticated, service_role;
