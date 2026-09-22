-- 20260922000007: Prof. Session day practice attach — year-scoped questions
-- Product Blocks have no authored questions; Q-bank lives on departmental subjects
-- in the same class. Allow attach when question.subject.year_id = day.year_id.
-- Isolation remains via prof_session_day_practice_questions (day_id), not subject.

create or replace function public.admin_set_day_practice_questions(
  p_day_id uuid,
  p_question_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prof_session_days%rowtype;
  v_qid uuid;
  v_i int;
  v_q_year uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.prof_session_days where id = p_day_id;
  if not found then
    raise exception 'day_not_found';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'day_deleted';
  end if;
  if v_row.subject_id is null then
    raise exception 'subject_id_required';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  delete from public.prof_session_day_practice_questions where day_id = p_day_id;

  if p_question_ids is null or cardinality(p_question_ids) = 0 then
    return;
  end if;

  for v_i in 1 .. cardinality(p_question_ids) loop
    v_qid := p_question_ids[v_i];
    select s.year_id into v_q_year
    from public.questions q
    join public.subjects s on s.id = q.subject_id
    where q.id = v_qid
      and q.deleted_at is null;
    if v_q_year is null then
      raise exception 'question_not_found';
    end if;
    if v_q_year is distinct from v_row.year_id then
      raise exception 'question_year_mismatch';
    end if;
    insert into public.prof_session_day_practice_questions (day_id, question_id, sort_order)
    values (p_day_id, v_qid, v_i)
    on conflict (day_id, question_id) do update set sort_order = excluded.sort_order;
  end loop;

  perform public.log_audit(
    'prof_session_day_practice_set',
    'prof_session_day',
    p_day_id,
    jsonb_build_object('count', cardinality(p_question_ids))
  );
end;
$$;

revoke execute on function public.admin_set_day_practice_questions(uuid, uuid[]) from public, anon;
grant execute on function public.admin_set_day_practice_questions(uuid, uuid[]) to authenticated, service_role;

comment on function public.admin_set_day_practice_questions(uuid, uuid[]) is
  'Replace day practice set. Questions must belong to any subject in the day year (existing Q-bank); no duplication.';
