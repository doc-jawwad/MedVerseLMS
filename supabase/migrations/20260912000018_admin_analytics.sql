-- 0018: admin analytics (Phase 10). Computed live via SQL — plain summary
-- tables refreshed by cron are deferred until real data volume warrants it
-- (docs/database.md question_stats/test_stats note).

create or replace function public.admin_platform_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_active int; v_inactive int; v_tests_month int; v_attempts int; v_avg numeric;
  v_hardest_topic text; v_best_subject text; v_participation numeric;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select count(*) filter (where status = 'active'),
         count(*) filter (where status <> 'active')
  into v_active, v_inactive
  from public.enrollments;

  select count(*) into v_tests_month
  from public.tests
  where status in ('published', 'closed')
    and created_at >= date_trunc('month', now());

  select count(*), round(coalesce(avg(percentage), 0), 2)
  into v_attempts, v_avg
  from public.test_attempts where state = 'submitted';

  -- hardest topic = lowest average correctness across practice + test answers
  select t.name into v_hardest_topic
  from public.topics t
  join public.questions q on q.topic_id = t.id
  join public.question_versions qv on qv.id = q.current_version_id
  left join public.attempt_answers aa on aa.question_version_id = qv.id
  left join public.practice_answers pa on pa.question_version_id = qv.id
  where aa.id is not null or pa.id is not null
  group by t.id, t.name
  having count(aa.id) + count(pa.id) >= 3
  order by (
    (count(*) filter (where aa.selected_key = qv.correct_key or pa.is_correct))::numeric
    / nullif(count(aa.id) + count(pa.id), 0)
  ) asc
  limit 1;

  -- best-performing subject by average submitted test percentage
  select s.name into v_best_subject
  from public.subjects s
  join public.tests t on t.subject_id = s.id
  join public.test_attempts a on a.test_id = t.id and a.state = 'submitted'
  group by s.id, s.name
  order by avg(a.percentage) desc
  limit 1;

  select case when count(*) = 0 then 0
    else round(100.0 * count(*) filter (where a.id is not null) / count(*), 2) end
  into v_participation
  from public.enrollments e
  left join public.test_attempts a
    on a.student_id = e.student_id and a.state = 'submitted'
  where e.status = 'active';

  return jsonb_build_object(
    'active_students', coalesce(v_active, 0),
    'inactive_students', coalesce(v_inactive, 0),
    'tests_this_month', coalesce(v_tests_month, 0),
    'total_attempts', coalesce(v_attempts, 0),
    'average_score_pct', coalesce(v_avg, 0),
    'hardest_topic', v_hardest_topic,
    'best_subject', v_best_subject,
    'participation_pct', coalesce(v_participation, 0)
  );
end;
$$;

-- Question difficulty / most-missed, across both practice and test exposure.
create or replace function public.question_difficulty_report(p_limit int default 20)
returns table (
  question_id uuid,
  stem text,
  subject_name text,
  attempts bigint,
  correct bigint,
  p_value numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select q.id, qv.stem, s.name,
    count(*) as attempts,
    count(*) filter (where e.correct) as correct,
    round(100.0 * count(*) filter (where e.correct) / count(*), 2) as p_value
  from public.questions q
  join public.question_versions qv on qv.id = q.current_version_id
  join public.subjects s on s.id = q.subject_id
  join (
    select aa.question_version_id, (aa.selected_key = aaqv.correct_key) as correct
    from public.attempt_answers aa
    join public.question_versions aaqv on aaqv.id = aa.question_version_id
    where aa.selected_key is not null
    union all
    select pa.question_version_id, pa.is_correct as correct
    from public.practice_answers pa
  ) e on e.question_version_id = qv.id
  group by q.id, qv.stem, s.name
  having count(*) >= 3
  order by round(100.0 * count(*) filter (where e.correct) / count(*), 2) asc
  limit greatest(1, least(p_limit, 100));
end;
$$;

-- Full student profile for the admin (docs match the "Student profile" mock).
create or replace function public.admin_student_profile(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile jsonb;
  v_enrollment jsonb;
  v_perf jsonb;
  v_grants jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select jsonb_build_object('full_name', full_name, 'email', email, 'last_login_at', last_login_at)
  into v_profile from public.profiles where id = p_student_id;

  select jsonb_build_object('status', e.status, 'year_id', e.year_id, 'year_name', y.name)
  into v_enrollment
  from public.enrollments e join public.years y on y.id = e.year_id
  where e.student_id = p_student_id and e.status in ('pending', 'active')
  order by e.created_at desc limit 1;

  select jsonb_build_object(
    'tests_taken', count(*),
    'average_percentage', round(coalesce(avg(percentage), 0), 2),
    'highest_percentage', coalesce(max(percentage), 0),
    'last_test_at', max(submitted_at)
  ) into v_perf
  from public.test_attempts where student_id = p_student_id and state = 'submitted';

  select jsonb_agg(jsonb_build_object(
    'subject_id', s.id, 'subject_name', s.name,
    'practice_granted', exists (
      select 1 from public.access_grants g
      where g.student_id = p_student_id and g.grant_type = 'practice_subject'
        and g.subject_id = s.id and g.revoked_at is null
    )
  ))
  into v_grants
  from public.subjects s
  join public.enrollments e on e.year_id = s.year_id and e.student_id = p_student_id
  where e.status in ('pending', 'active');

  return jsonb_build_object(
    'profile', v_profile,
    'enrollment', v_enrollment,
    'performance', v_perf,
    'subject_access', coalesce(v_grants, '[]'::jsonb)
  );
end;
$$;
