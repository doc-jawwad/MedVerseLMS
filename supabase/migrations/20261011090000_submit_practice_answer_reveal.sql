-- Practice answer persistence: optional silent submit (Next without Check).
-- When p_reveal_feedback is false, do NOT return is_correct, correct_key,
-- explanation, or reference (no correctness leak over the wire).
-- Same selected_key for the same version is stored once; incorrect cursor still refreshes.

create or replace function public.submit_practice_answer(
  p_question_version_id uuid,
  p_selected_key char,
  p_reveal_feedback boolean default true
)
returns table (
  is_correct boolean,
  correct_key char,
  explanation text,
  reference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_version public.question_versions%rowtype;
  v_question public.questions%rowtype;
  v_correct boolean;
  v_already boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select * into v_version from public.question_versions where id = p_question_version_id;
  if not found then
    raise exception 'question version not found';
  end if;
  select * into v_question from public.questions where id = v_version.question_id;
  if not found or v_question.status is distinct from 'approved' or v_question.deleted_at is not null then
    raise exception 'question version not found';
  end if;

  if not public.can_set_question_practice_progress(v_question.id) then
    raise exception 'practice_access_denied';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_version.options) o
    where o ->> 'key' = p_selected_key::text
  ) then
    raise exception 'invalid option %', p_selected_key;
  end if;

  v_correct := (p_selected_key = v_version.correct_key);

  select exists (
    select 1
    from public.practice_answers pa
    where pa.student_id = v_uid
      and pa.question_version_id = p_question_version_id
      and pa.selected_key = p_selected_key
  ) into v_already;

  if not v_already then
    insert into public.practice_answers
      (student_id, question_version_id, selected_key, is_correct, subject_id, chapter_id, topic_id)
    values
      (v_uid, p_question_version_id, p_selected_key, v_correct,
       v_question.subject_id, v_question.chapter_id, v_question.topic_id);
  end if;

  -- Incorrect cursor: wrong answers enter; correct answers leave. Preserve Done/Favorites.
  perform set_config('medverse.practice_progress_rpc', '1', true);
  insert into public.practice_progress (
    student_id, item_kind, item_id, state, marked, incorrect, subject_id
  ) values (
    v_uid, 'question', v_question.id, 'remaining', false, (not v_correct), v_question.subject_id
  )
  on conflict (student_id, item_kind, item_id) do update
  set incorrect = excluded.incorrect,
      subject_id = excluded.subject_id,
      updated_at = now();
  perform set_config('medverse.practice_progress_rpc', '', true);

  if coalesce(p_reveal_feedback, true) then
    return query select v_correct, v_version.correct_key, v_version.explanation, v_version.reference;
  else
    -- Acknowledgement only: no correctness or answer-key payload to the client.
    return query select null::boolean, null::char, null::text, null::text;
  end if;
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

comment on function public.submit_practice_answer(uuid, char, boolean) is
  'Append practice_answers once per (student, version, selected_key); set incorrect cursor. p_reveal_feedback=false returns no is_correct/correct_key/explanation/reference.';

-- Drop prior 2-arg overload if present so clients resolve the 3-arg default form.
drop function if exists public.submit_practice_answer(uuid, char);

revoke execute on function public.submit_practice_answer(uuid, char, boolean)
  from public, anon;
grant execute on function public.submit_practice_answer(uuid, char, boolean)
  to authenticated, service_role;
