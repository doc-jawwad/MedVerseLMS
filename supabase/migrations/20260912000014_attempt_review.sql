-- 0014: post-exam review, gated by tests.show_review (docs/test-rules.md)

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
    return jsonb_build_object('allowed', false, 'reason',
      case t.show_review
        when 'never' then 'review_disabled'
        else 'available_after_close'
      end,
      'closes_at', t.closes_at);
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
