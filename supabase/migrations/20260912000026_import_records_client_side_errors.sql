-- QA finding BUG-011: rows the client rejected during CSV/XLSX preview
-- validation (missing options, invalid correct key, etc.) were never sent to
-- import_question_batch at all, so they never got an import_rows entry and
-- import_batches.errors undercounted — the only record of why they failed
-- existed transiently in the browser during the upload session.
-- Fix: the client now sends every parsed row, tagging invalid ones with
-- `client_errors`. When present, this RPC records an 'error' import_rows
-- entry immediately and skips straight to the next row — it never attempts
-- book/chapter/topic resolution or create_question for a row the client
-- already knows is malformed, so no bad question can ever be created from it.
create or replace function public.import_question_batch(
  p_batch_id uuid,
  p_rows jsonb,           -- [{row_number, subject_id, book, chapter, topic, stem, options, correct_key, explanation, reference, difficulty, tags, status, client_errors?}]
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
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      if r ? 'client_errors' and jsonb_typeof(r -> 'client_errors') = 'array'
         and jsonb_array_length(r -> 'client_errors') > 0 then
        v_errors := v_errors + 1;
        insert into public.import_rows (batch_id, row_number, outcome, error_message)
        values (
          p_batch_id,
          (r ->> 'row_number')::int,
          'error',
          (select string_agg(e, '; ') from jsonb_array_elements_text(r -> 'client_errors') e)
        );
        continue;
      end if;

      -- resolve hierarchy by name under the given subject
      select id into v_book_id from public.books
        where subject_id = (r ->> 'subject_id')::uuid and lower(name) = lower(trim(r ->> 'book'));
      if v_book_id is null then
        if not p_create_missing then raise exception 'unknown book: %', r ->> 'book'; end if;
        insert into public.books (subject_id, name) values ((r ->> 'subject_id')::uuid, trim(r ->> 'book'))
          returning id into v_book_id;
      end if;

      select id into v_chapter_id from public.chapters
        where book_id = v_book_id and lower(name) = lower(trim(r ->> 'chapter'));
      if v_chapter_id is null then
        if not p_create_missing then raise exception 'unknown chapter: %', r ->> 'chapter'; end if;
        insert into public.chapters (book_id, name) values (v_book_id, trim(r ->> 'chapter'))
          returning id into v_chapter_id;
      end if;

      select id into v_topic_id from public.topics
        where chapter_id = v_chapter_id and lower(name) = lower(trim(r ->> 'topic'));
      if v_topic_id is null then
        if not p_create_missing then raise exception 'unknown topic: %', r ->> 'topic'; end if;
        insert into public.topics (chapter_id, name) values (v_chapter_id, trim(r ->> 'topic'))
          returning id into v_topic_id;
      end if;

      -- exact duplicate check
      if exists (
        select 1 from public.questions
        where content_hash = public.question_content_hash(
          r ->> 'stem', r -> 'options', (r ->> 'correct_key')::char(1))
      ) then
        v_skipped := v_skipped + 1;
        insert into public.import_rows (batch_id, row_number, outcome)
        values (p_batch_id, (r ->> 'row_number')::int, 'skipped_duplicate');
        continue;
      end if;

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

      v_inserted := v_inserted + 1;
      insert into public.import_rows (batch_id, row_number, outcome, question_id)
      values (p_batch_id, (r ->> 'row_number')::int, 'inserted', v_question_id);
    exception when others then
      v_errors := v_errors + 1;
      insert into public.import_rows (batch_id, row_number, outcome, error_message)
      values (p_batch_id, (r ->> 'row_number')::int, 'error', SQLERRM);
    end;
  end loop;

  update public.import_batches
  set inserted = inserted + v_inserted,
      skipped_duplicates = skipped_duplicates + v_skipped,
      errors = errors + v_errors
  where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;
