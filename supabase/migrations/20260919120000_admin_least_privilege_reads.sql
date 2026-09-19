-- Security Check 2 F1: admin least-privilege reads.
-- Sensitive student/ops SELECT no longer uses blanket is_admin().
-- Main Admin continues to pass via has_permission() short-circuit.
-- Content-bank / curriculum catalog SELECT stays is_admin() (pending curriculum code).
-- UI checks remain UX-only; RLS + DEFINER RPC gates are authoritative.

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER + search_path = public; reuse has_permission)
-- ---------------------------------------------------------------------------
create or replace function public.can_admin_select_profiles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('view_students')
    or public.has_permission('manage_students')
    or public.has_permission('activate_students')
    or public.has_permission('restrict_students')
    or public.has_permission('manage_subscriptions')
    or public.has_permission('review_subscription_applications')
    or public.has_permission('manage_year_changes')
    or public.has_permission('manage_admins')
    or public.has_permission('grant_resource_access');
$$;

create or replace function public.can_admin_select_enrollments()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('view_students')
    or public.has_permission('manage_year_changes')
    or public.has_permission('manage_subscriptions')
    or public.has_permission('grant_resource_access');
$$;

create or replace function public.can_admin_select_attempts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('view_students')
    or public.has_permission('view_analytics')
    or public.has_permission('publish_tests');
$$;

create or replace function public.can_admin_select_attempt_detail()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('view_students')
    or public.has_permission('view_analytics');
$$;

create or replace function public.can_admin_select_audit_logs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('manage_admins')
    or public.has_permission('manage_system_settings');
$$;

revoke execute on function public.can_admin_select_profiles() from public, anon;
grant execute on function public.can_admin_select_profiles() to authenticated, service_role;
revoke execute on function public.can_admin_select_enrollments() from public, anon;
grant execute on function public.can_admin_select_enrollments() to authenticated, service_role;
revoke execute on function public.can_admin_select_attempts() from public, anon;
grant execute on function public.can_admin_select_attempts() to authenticated, service_role;
revoke execute on function public.can_admin_select_attempt_detail() from public, anon;
grant execute on function public.can_admin_select_attempt_detail() to authenticated, service_role;
revoke execute on function public.can_admin_select_audit_logs() from public, anon;
grant execute on function public.can_admin_select_audit_logs() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (
    id = (select auth.uid())
    or public.can_admin_select_profiles()
  );

-- ---------------------------------------------------------------------------
-- enrollments / grants / restrictions
-- ---------------------------------------------------------------------------
drop policy if exists enrollments_student_select on public.enrollments;
create policy enrollments_student_select on public.enrollments
  for select using (
    student_id = (select auth.uid())
    or public.can_admin_select_enrollments()
  );

drop policy if exists access_grants_student_select on public.access_grants;
create policy access_grants_student_select on public.access_grants
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('grant_resource_access')
    or public.has_permission('view_students')
  );

drop policy if exists access_restrictions_select on public.access_restrictions;
create policy access_restrictions_select on public.access_restrictions
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('grant_resource_access')
    or public.has_permission('view_students')
  );

-- ---------------------------------------------------------------------------
-- year changes / subscriptions / payments / notifications
-- ---------------------------------------------------------------------------
drop policy if exists year_change_requests_select on public.year_change_requests;
create policy year_change_requests_select on public.year_change_requests
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('manage_year_changes')
  );

drop policy if exists subscriptions_student_select on public.subscriptions;
create policy subscriptions_student_select on public.subscriptions
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('manage_subscriptions')
  );

drop policy if exists subscription_plans_student_select on public.subscription_plans;
create policy subscription_plans_student_select on public.subscription_plans
  for select using (
    is_active
    or public.has_permission('manage_subscriptions')
    or public.has_permission('review_subscription_applications')
  );

drop policy if exists payment_settings_admin_select on public.payment_settings;
create policy payment_settings_admin_select on public.payment_settings
  for select using (
    public.has_permission('manage_payment_settings')
    or public.has_permission('manage_system_settings')
  );

drop policy if exists subscription_applications_select on public.subscription_applications;
create policy subscription_applications_select on public.subscription_applications
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('review_subscription_applications')
  );

drop policy if exists student_notifications_select on public.student_notifications;
create policy student_notifications_select on public.student_notifications
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('view_students')
    or public.has_permission('manage_subscriptions')
  );

-- ---------------------------------------------------------------------------
-- attempts / answers / practice
-- ---------------------------------------------------------------------------
drop policy if exists test_attempts_student_select on public.test_attempts;
create policy test_attempts_student_select on public.test_attempts
  for select using (
    student_id = (select auth.uid())
    or public.can_admin_select_attempts()
  );

drop policy if exists attempt_answers_admin_select on public.attempt_answers;
create policy attempt_answers_admin_select on public.attempt_answers
  for select using (public.can_admin_select_attempt_detail());

drop policy if exists practice_seen_student_select on public.practice_seen;
create policy practice_seen_student_select on public.practice_seen
  for select using (
    student_id = (select auth.uid())
    or public.can_admin_select_attempt_detail()
  );

drop policy if exists practice_answers_student_select on public.practice_answers;
create policy practice_answers_student_select on public.practice_answers
  for select using (
    student_id = (select auth.uid())
    or public.can_admin_select_attempt_detail()
  );

-- ---------------------------------------------------------------------------
-- audit + RBAC catalog
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select using (public.can_admin_select_audit_logs());

drop policy if exists permissions_admin_select on public.permissions;
create policy permissions_admin_select on public.permissions
  for select using (public.has_permission('manage_admins'));

drop policy if exists admin_permissions_admin_select on public.admin_permissions;
create policy admin_permissions_admin_select on public.admin_permissions
  for select using (
    admin_id = (select auth.uid())
    or public.has_permission('manage_admins')
  );

-- ---------------------------------------------------------------------------
-- DEFINER RPCs that previously used is_admin() for admin-side student data
-- ---------------------------------------------------------------------------
create or replace function public.test_leaderboard(p_test_id uuid)
returns table (
  rank int,
  percentile numeric,
  student_id uuid,
  full_name text,
  score numeric,
  max_score numeric,
  percentage numeric,
  is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select a.rank, a.percentile, a.student_id, p.full_name,
         a.score, a.max_score, a.percentage,
         a.student_id = (select auth.uid())
  from public.test_attempts a
  join public.profiles p on p.id = a.student_id
  where a.test_id = p_test_id
    and a.state = 'submitted'
    and (
      public.can_access_test(p_test_id)
      or public.has_permission('view_analytics')
      or public.has_permission('view_students')
      or public.has_permission('publish_tests')
    )
  order by a.rank asc nulls last;
$$;

create or replace function public.get_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  v_allowed boolean;
  v_items jsonb;
  v_admin_review boolean;
begin
  v_admin_review := public.can_admin_select_attempt_detail();

  select * into a from public.test_attempts
  where id = p_attempt_id
    and (student_id = (select auth.uid()) or v_admin_review);
  if not found then raise exception 'attempt_not_found'; end if;
  if a.state <> 'submitted' then raise exception 'attempt_not_submitted'; end if;

  select * into t from public.tests where id = a.test_id;

  v_allowed := v_admin_review
    or t.show_review = 'after_submit'
    or (t.show_review = 'after_close' and now() >= t.closes_at);

  if not v_allowed then
    return jsonb_build_object(
      'allowed', false,
      'reason', case t.show_review
        when 'never' then 'review_disabled'
        else 'available_after_close'
      end,
      'closes_at', t.closes_at
    );
  end if;

  -- Paid / plan resources require live content entitlement. Free tests keep
  -- existing show_review-only rules. Permissioned admins keep review access.
  if not v_admin_review
     and coalesce(t.entitlement, 'free') <> 'free'
     and not public.resource_content_allowed(
       'test', null, t.id, null, t.entitlement, t.required_plan_id
     ) then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'review_locked_entitlement'
    );
  end if;

  select jsonb_agg(item order by (item ->> 'idx')::int) into v_items
  from (
    select jsonb_build_object(
      'idx', ord.idx,
      'stem', qv.stem,
      'options', qv.options,
      'correct_key', trim(qv.correct_key::text),
      'explanation', qv.explanation,
      'reference', qv.reference,
      'selected_key', trim(ans.selected_key::text),
      'marked_for_review', coalesce(ans.marked_for_review, false),
      'voided', coalesce(tq.voided, false),
      'void_policy', tq.void_policy
    ) as item
    from unnest(a.question_order) with ordinality ord(qv_id, idx)
    join public.question_versions qv on qv.id = ord.qv_id
    left join public.attempt_answers ans
      on ans.attempt_id = a.id and ans.question_version_id = qv.id
    left join public.test_questions tq
      on tq.test_id = a.test_id and tq.question_version_id = qv.id
  ) s;

  return jsonb_build_object('allowed', true, 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_attempt_review(uuid) is
  'Owner or permissioned-admin review payload (view_students|view_analytics). Paid tests require live resource_content_allowed for students. Denied paid review returns reason review_locked_entitlement with no items.';
