-- 8J-B: historical own submitted result, authorized by attempt ownership.
-- Does not return review payload. Does not change can_view_test / 8J-A.

create or replace function public.get_own_test_result(p_test_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  v_invalidated jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  -- Ownership only: caller identity is auth.uid(). No client student_id.
  -- One non-invalidated row per (test, student); submitted is that row.
  select * into a
  from public.test_attempts
  where test_id = p_test_id
    and student_id = v_uid
    and state = 'submitted';
  if not found then
    return null;
  end if;

  select * into t from public.tests where id = a.test_id;
  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'invalidated_reason', i.invalidated_reason
      )
      order by i.created_at
    ),
    '[]'::jsonb
  )
  into v_invalidated
  from public.test_attempts i
  where i.test_id = p_test_id
    and i.student_id = v_uid
    and i.state = 'invalidated';

  return jsonb_build_object(
    'test', jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'closes_at', t.closes_at,
      'show_review', t.show_review,
      'negative_mark', t.negative_mark
    ),
    'attempt', jsonb_build_object(
      'id', a.id,
      'state', a.state,
      'score', a.score,
      'max_score', a.max_score,
      'raw_correct', a.raw_correct,
      'raw_wrong', a.raw_wrong,
      'raw_blank', a.raw_blank,
      'percentage', a.percentage,
      'rank', a.rank,
      'percentile', a.percentile,
      'submitted_at', a.submitted_at,
      'submit_source', a.submit_source
    ),
    'invalidated', v_invalidated
  );
end;
$$;

comment on function public.get_own_test_result(uuid) is
  'Caller-owned submitted result summary (auth.uid()). Ignores current catalog/entitlement/year. No review items.';

revoke execute on function public.get_own_test_result(uuid) from public, anon;
grant execute on function public.get_own_test_result(uuid) to authenticated, service_role;
