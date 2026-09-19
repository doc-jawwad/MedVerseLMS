-- Security Check 5 Medium 1: blocked students must not read review content.
-- Admins with view_students|view_analytics keep review access.
-- Live-exam Layer 2 (save/submit/resume) is unchanged.

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

  -- Student callers require an active LMS account. Permissioned admins retain
  -- review. Live-exam continuation is not this RPC (resume/save/submit only).
  if not v_admin_review and not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

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

revoke execute on function public.get_attempt_review(uuid) from public, anon;
grant execute on function public.get_attempt_review(uuid) to authenticated, service_role;

comment on function public.get_attempt_review(uuid) is
  'Owner (account_allows_lms) or permissioned-admin review payload (view_students|view_analytics). Paid tests require live resource_content_allowed for students. Blocked student accounts raise account_not_eligible. Denied paid review returns reason review_locked_entitlement with no items.';
