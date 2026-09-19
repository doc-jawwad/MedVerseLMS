-- Security Check 4 Medium fixes (F2–F4). App gate for F1 is in require-user/proxy.
-- F2: ensure_profile year self-assignment only on true first provision
-- F3: question/test/material SELECT + open_material use granular permissions
-- F4: approve_subscription_application claim-first + grace-aware live lookup

-- ---------------------------------------------------------------------------
-- F2: year_id from JWT only when the student has never had any enrollment
-- ---------------------------------------------------------------------------
create or replace function public.ensure_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (select auth.uid());
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_meta jsonb;
  v_email text;
  v_name text;
  v_year uuid;
begin
  if v_id is null then
    raise exception 'not authenticated';
  end if;

  v_meta := coalesce(v_claims -> 'user_metadata', '{}'::jsonb);
  if jsonb_typeof(v_meta) <> 'object' then
    v_meta := '{}'::jsonb;
  end if;

  v_email := coalesce(v_claims ->> 'email', '');
  v_name := coalesce(v_meta ->> 'full_name', '');

  insert into public.profiles (id, email, full_name)
  values (v_id, v_email, v_name)
  on conflict (id) do update
    set email = case when excluded.email <> '' then excluded.email else public.profiles.email end,
        full_name = case
          when excluded.full_name <> '' then excluded.full_name
          else public.profiles.full_name
        end;
  -- role, account_status, is_main_admin are never written here.

  begin
    v_year := nullif(v_meta ->> 'year_id', '')::uuid;
  exception when invalid_text_representation then
    v_year := null;
  end;

  -- Self-service year choice is first provision only. Any historical enrollment
  -- (expired/revoked/suspended/active) means later year changes are admin-mediated.
  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    select v_id, v_year, 'active'
    where not exists (
      select 1 from public.enrollments
      where student_id = v_id
    );
  end if;
end;
$$;

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
  )
  on conflict (id) do nothing;

  begin
    v_year := nullif(new.raw_user_meta_data ->> 'year_id', '')::uuid;
  exception when invalid_text_representation then
    v_year := null;
  end;

  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    select new.id, v_year, 'active'
    where not exists (
      select 1 from public.enrollments
      where student_id = new.id
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F3: content-bank / materials admin SELECT + open_material least privilege
-- Reuse existing permission codes (no new codes).
-- ---------------------------------------------------------------------------
create or replace function public.can_admin_select_questions()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('edit_questions')
    or public.has_permission('import_questions');
$$;

create or replace function public.can_admin_select_tests()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('publish_tests')
    or public.has_permission('edit_questions');
$$;

create or replace function public.can_admin_select_materials()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('manage_materials');
$$;

revoke execute on function public.can_admin_select_questions() from public, anon;
grant execute on function public.can_admin_select_questions() to authenticated, service_role;
revoke execute on function public.can_admin_select_tests() from public, anon;
grant execute on function public.can_admin_select_tests() to authenticated, service_role;
revoke execute on function public.can_admin_select_materials() from public, anon;
grant execute on function public.can_admin_select_materials() to authenticated, service_role;

drop policy if exists questions_admin_select on public.questions;
create policy questions_admin_select on public.questions
  for select using (public.can_admin_select_questions());

drop policy if exists question_versions_admin_select on public.question_versions;
create policy question_versions_admin_select on public.question_versions
  for select using (public.can_admin_select_questions());

drop policy if exists import_batches_admin_select on public.import_batches;
create policy import_batches_admin_select on public.import_batches
  for select using (public.has_permission('import_questions'));

drop policy if exists import_rows_admin_select on public.import_rows;
create policy import_rows_admin_select on public.import_rows
  for select using (public.has_permission('import_questions'));

drop policy if exists tests_admin_select on public.tests;
create policy tests_admin_select on public.tests
  for select using (public.can_admin_select_tests());

drop policy if exists test_questions_admin_select on public.test_questions;
create policy test_questions_admin_select on public.test_questions
  for select using (public.can_admin_select_tests());

drop policy if exists test_audiences_admin_select on public.test_audiences;
create policy test_audiences_admin_select on public.test_audiences
  for select using (public.can_admin_select_tests());

drop policy if exists material_folders_admin_select on public.material_folders;
create policy material_folders_admin_select on public.material_folders
  for select using (public.can_admin_select_materials());

drop policy if exists materials_admin_select on public.materials;
create policy materials_admin_select on public.materials
  for select using (public.can_admin_select_materials());

create or replace function public.open_material(p_material_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder_id uuid;
  v_url text;
begin
  select folder_id, drive_url into v_folder_id, v_url
  from public.materials
  where id = p_material_id;

  if v_url is null then
    raise exception 'material_access_denied';
  end if;

  -- Admin Drive URL access requires manage_materials (Main Admin included
  -- via has_permission short-circuit). Zero-permission/ops admins are denied.
  if public.has_permission('manage_materials') then
    return v_url;
  end if;

  if not public.can_access_material_folder(v_folder_id) then
    raise exception 'material_access_denied';
  end if;

  return v_url;
end;
$$;

revoke execute on function public.open_material(uuid) from public, anon;
grant execute on function public.open_material(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F4: claim pending before entitlement; live lookup includes grace
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

  -- Lock the application row so concurrent approvers serialize on one winner.
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

  -- Claim pending → approved BEFORE any entitlement mutation. A concurrent
  -- or replayed caller that lost the race sees application_not_pending.
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

  -- Live includes grace (subscription_is_live_at), matching activate/extend.
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
    set application_id = p_application_id
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
      p_application_id
    );
  end if;

  perform public.log_audit(
    'subscription_application_approved',
    'subscription_application',
    p_application_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'subscription_id', v_sub,
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

revoke execute on function public.approve_subscription_application(uuid, text) from public, anon;
grant execute on function public.approve_subscription_application(uuid, text) to authenticated, service_role;

comment on function public.ensure_profile() is
  'Idempotent profile provision. Self-service year enrollment only when the subject has never had any enrollments row.';
comment on function public.open_material(uuid) is
  'Returns drive_url after student entitlement or manage_materials. Students never SELECT drive_url directly.';
comment on function public.approve_subscription_application(uuid, text) is
  'Claims pending→approved under row lock before extend/activate; live lookup uses subscription_is_live_at (includes grace).';
