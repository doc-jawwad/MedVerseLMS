-- Serve a batch of practice questions: unseen first (cycle asc), random within
-- a cycle; serving increments practice_seen. correct_key/explanation OMITTED.
create or replace function public.get_practice_batch(
  p_scope_type text,     -- 'subject' | 'book' | 'chapter' | 'topic'
  p_scope_id uuid,
  p_limit int default 10
)
returns table (
  question_id uuid,
  question_version_id uuid,
  stem text,
  options jsonb,
  difficulty text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_subject_id uuid;
begin
  if p_scope_type not in ('subject', 'book', 'chapter', 'topic') then
    raise exception 'invalid scope type %', p_scope_type;
  end if;

  v_subject_id := case p_scope_type
    when 'subject' then p_scope_id
    when 'book' then (select subject_id from public.books where id = p_scope_id)
    when 'chapter' then (select subject_id from public.chapters where id = p_scope_id)
    when 'topic' then (select subject_id from public.topics where id = p_scope_id)
  end;

  if v_subject_id is null or not public.has_practice_access(v_subject_id) then
    raise exception 'practice_access_denied';
  end if;

  return query
  with candidates as (
    select q.id, q.current_version_id, q.difficulty
    from public.questions q
    where q.status = 'approved'
      and case p_scope_type
        when 'subject' then q.subject_id = p_scope_id
        when 'book' then q.book_id = p_scope_id
        when 'chapter' then q.chapter_id = p_scope_id
        when 'topic' then q.topic_id = p_scope_id
      end
  ),
  picked as (
    select c.id, c.current_version_id, c.difficulty
    from candidates c
    left join public.practice_seen s
      on s.question_id = c.id and s.student_id = (select auth.uid())
    order by coalesce(s.cycle, 0) asc, random()
    limit greatest(1, least(p_limit, 50))
  ),
  marked as (
    insert into public.practice_seen (student_id, question_id)
    select (select auth.uid()), p.id from picked p
    on conflict (student_id, question_id)
      do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
    returning question_id
  )
  select p.id, v.id, v.stem, v.options, p.difficulty
  from picked p
  join public.question_versions v on v.id = p.current_version_id
  join marked m on m.question_id = p.id;
end;
$$;
