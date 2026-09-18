-- 8J-A: paid-test review lock after entitlement expiry.
-- Score/result summary stays on test_attempts. Review items are RPC-only.
-- Does not rewrite attempts, scores, or ranks.

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
begin
  select * into a from public.test_attempts
  where id = p_attempt_id
    and (student_id = (select auth.uid()) or public.is_admin());
  if not found then raise exception 'attempt_not_found'; end if;
  if a.state <> 'submitted' then raise exception 'attempt_not_submitted'; end if;

  select * into t from public.tests where id = a.test_id;

  v_allowed := public.is_admin()
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
  -- existing show_review-only rules. Admins keep existing review access.
  if not public.is_admin()
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
  'Owner/admin review payload. Paid tests require live resource_content_allowed. Denied paid review returns reason review_locked_entitlement with no items.';

drop policy if exists attempt_answers_select on public.attempt_answers;

create policy attempt_answers_admin_select on public.attempt_answers
  for select using (public.is_admin());
