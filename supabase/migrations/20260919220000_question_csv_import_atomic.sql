-- Question Bank CSV import hardening (applied locally as 20260919220000).
-- 1) Atomic batch: hard errors re-raise so the RPC transaction rolls back.
-- 2) Refuse payloads that still carry client_errors.
-- 3) Duplicates remain explicit skips (never overwrite).
-- 4) Return inserted question_ids for post-import edit links.
-- Permission: require_permission('import_questions').

create or replace function public.import_question_batch(
  p_batch_id uuid,
  p_rows jsonb,
  p_create_missing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_book_id uuid;
  v_chapter_id uuid;
  v_topic_id uuid;
  v_question_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_errors int := 0;
  v_status text;
  v_question_ids uuid[] := '{}';
  v_row_number int;
begin
  perform public.require_permission('import_questions');

  if exists (
    select 1
    from jsonb_array_elements(p_rows) x
    where x.value ? 'client_errors'
      and jsonb_typeof(x.value -> 'client_errors') = 'array'
      and jsonb_array_length(x.value -> 'client_errors') > 0
  ) then
    raise exception 'csv_validation_required: fix CSV errors before import';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row_number := (r ->> 'row_number')::int;

    select id into v_book_id from public.books
      where subject_id = (r ->> 'subject_id')::uuid and lower(name) = lower(trim(r ->> 'book'));
    if v_book_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown book: %', v_row_number, r ->> 'book';
      end if;
      insert into public.books (subject_id, name)
      values ((r ->> 'subject_id')::uuid, trim(r ->> 'book'))
      returning id into v_book_id;
    end if;

    select id into v_chapter_id from public.chapters
      where book_id = v_book_id and lower(name) = lower(trim(r ->> 'chapter'));
    if v_chapter_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown chapter: %', v_row_number, r ->> 'chapter';
      end if;
      insert into public.chapters (book_id, name)
      values (v_book_id, trim(r ->> 'chapter'))
      returning id into v_chapter_id;
    end if;

    select id into v_topic_id from public.topics
      where chapter_id = v_chapter_id and lower(name) = lower(trim(r ->> 'topic'));
    if v_topic_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown topic: %', v_row_number, r ->> 'topic';
      end if;
      insert into public.topics (chapter_id, name)
      values (v_chapter_id, trim(r ->> 'topic'))
      returning id into v_topic_id;
    end if;

    if exists (
      select 1 from public.questions
      where content_hash = public.question_content_hash(
        r ->> 'stem', r -> 'options', (r ->> 'correct_key')::char(1))
    ) then
      v_skipped := v_skipped + 1;
      insert into public.import_rows (batch_id, row_number, outcome)
      values (p_batch_id, v_row_number, 'skipped_duplicate');
      continue;
    end if;

    begin
      v_status := coalesce(nullif(r ->> 'status', ''), 'draft');
      v_question_id := public.create_question(
        v_topic_id,
        r ->> 'stem',
        r -> 'options',
        (r ->> 'correct_key')::char(1),
        coalesce(r ->> 'explanation', ''),
        coalesce(r ->> 'reference', ''),
        coalesce(nullif(r ->> 'difficulty', ''), 'medium'),
        case when r ? 'tags' and jsonb_typeof(r -> 'tags') = 'array'
          then array(select jsonb_array_elements_text(r -> 'tags')) else '{}' end,
        v_status
      );
    exception when others then
      raise exception 'import row % failed: %', v_row_number, SQLERRM;
    end;

    v_inserted := v_inserted + 1;
    v_question_ids := array_append(v_question_ids, v_question_id);
    insert into public.import_rows (batch_id, row_number, outcome, question_id)
    values (p_batch_id, v_row_number, 'inserted', v_question_id);
  end loop;

  update public.import_batches
  set inserted = inserted + v_inserted,
      skipped_duplicates = skipped_duplicates + v_skipped,
      errors = errors + v_errors
  where id = p_batch_id;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'errors', v_errors,
    'question_ids', to_jsonb(v_question_ids)
  );
end;
$$;

revoke all on function public.import_question_batch(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_question_batch(uuid, jsonb, boolean) to authenticated;

comment on function public.import_question_batch(uuid, jsonb, boolean) is
  'Bulk Question Bank CSV import. Atomic: hard errors abort the RPC transaction. Duplicates are skipped, never overwritten. CSV client_errors must be cleared before call.';
