-- Concurrent-safe Question Bank CSV import.
-- Race 1: same missing book/chapter/topic → ON CONFLICT then re-SELECT.
-- Race 2: identical content_hash → unique_violation → skipped_duplicate.
-- Genuine / unexpected errors still abort the whole RPC (atomic).

create or replace function public.import_question_batch(
  p_batch_id uuid,
  p_rows jsonb,
  p_create_missing boolean default true,
  p_mcq_bank_subfolder_id uuid default null
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
  v_question_ids uuid[] := '{}';
  v_row_number int;
  v_sub public.mcq_bank_subfolders%rowtype;
  v_content_hash text;
  v_constraint text;
  v_race_skip boolean;
begin
  if not public.can_admin_import_questions() then
    if not public.is_admin() then
      raise exception 'admin only';
    else
      raise exception 'permission_denied';
    end if;
  end if;

  if p_mcq_bank_subfolder_id is not null then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
    select * into v_sub
    from public.mcq_bank_subfolders
    where id = p_mcq_bank_subfolder_id and deleted_at is null;
    if not found then
      raise exception 'mcq_bank_subfolder_not_found';
    end if;
    if not public.admin_can_access_year(v_sub.year_id) then
      raise exception 'year_scope_denied';
    end if;
  end if;

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
    v_question_id := null;
    v_book_id := null;
    v_chapter_id := null;
    v_topic_id := null;
    v_race_skip := false;

    select id into v_book_id from public.books
      where subject_id = (r ->> 'subject_id')::uuid and lower(name) = lower(trim(r ->> 'book'));
    if v_book_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown book: %', v_row_number, r ->> 'book';
      end if;
      insert into public.books (subject_id, name)
      values ((r ->> 'subject_id')::uuid, trim(r ->> 'book'))
      on conflict (subject_id, name) do nothing
      returning id into v_book_id;
      if v_book_id is null then
        select id into v_book_id from public.books
          where subject_id = (r ->> 'subject_id')::uuid
            and lower(name) = lower(trim(r ->> 'book'));
      end if;
      if v_book_id is null then
        raise exception 'import row % failed: book resolve failed: %', v_row_number, r ->> 'book';
      end if;
    end if;

    select id into v_chapter_id from public.chapters
      where book_id = v_book_id and lower(name) = lower(trim(r ->> 'chapter'));
    if v_chapter_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown chapter: %', v_row_number, r ->> 'chapter';
      end if;
      insert into public.chapters (book_id, name)
      values (v_book_id, trim(r ->> 'chapter'))
      on conflict (book_id, name) do nothing
      returning id into v_chapter_id;
      if v_chapter_id is null then
        select id into v_chapter_id from public.chapters
          where book_id = v_book_id
            and lower(name) = lower(trim(r ->> 'chapter'));
      end if;
      if v_chapter_id is null then
        raise exception 'import row % failed: chapter resolve failed: %', v_row_number, r ->> 'chapter';
      end if;
    end if;

    select id into v_topic_id from public.topics
      where chapter_id = v_chapter_id and lower(name) = lower(trim(r ->> 'topic'));
    if v_topic_id is null then
      if not p_create_missing then
        raise exception 'import row % failed: unknown topic: %', v_row_number, r ->> 'topic';
      end if;
      insert into public.topics (chapter_id, name)
      values (v_chapter_id, trim(r ->> 'topic'))
      on conflict (chapter_id, name) do nothing
      returning id into v_topic_id;
      if v_topic_id is null then
        select id into v_topic_id from public.topics
          where chapter_id = v_chapter_id
            and lower(name) = lower(trim(r ->> 'topic'));
      end if;
      if v_topic_id is null then
        raise exception 'import row % failed: topic resolve failed: %', v_row_number, r ->> 'topic';
      end if;
    end if;

    if p_mcq_bank_subfolder_id is not null then
      if (select year_id from public.topics where id = v_topic_id) is distinct from v_sub.year_id then
        raise exception 'import row % failed: mcq_bank_subfolder_year_mismatch', v_row_number;
      end if;
    end if;

    v_content_hash := public.question_content_hash(
      r ->> 'stem', r -> 'options', (r ->> 'correct_key')::char(1));

    select id into v_question_id from public.questions
      where content_hash = v_content_hash
      limit 1;

    if v_question_id is not null then
      v_skipped := v_skipped + 1;
      v_question_ids := array_append(v_question_ids, v_question_id);
      if p_mcq_bank_subfolder_id is not null then
        update public.questions
        set mcq_bank_subfolder_id = p_mcq_bank_subfolder_id
        where id = v_question_id
          and mcq_bank_subfolder_id is null
          and mcq_bank_folder_id is null
          and deleted_at is null;
      end if;
      insert into public.import_rows (batch_id, row_number, outcome, question_id)
      values (p_batch_id, v_row_number, 'skipped_duplicate', v_question_id);
      continue;
    end if;

    begin
      -- Approval workflow retired: always create as approved.
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
        'approved',
        p_mcq_bank_subfolder_id
      );
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'questions_content_hash_unique' then
          raise exception 'import row % failed: %', v_row_number, SQLERRM;
        end if;
        select id into v_question_id from public.questions
          where content_hash = v_content_hash
          limit 1;
        if v_question_id is null then
          raise exception 'import row % failed: %', v_row_number, SQLERRM;
        end if;
        v_race_skip := true;
      when others then
        raise exception 'import row % failed: %', v_row_number, SQLERRM;
    end;

    if v_race_skip then
      v_skipped := v_skipped + 1;
      v_question_ids := array_append(v_question_ids, v_question_id);
      if p_mcq_bank_subfolder_id is not null then
        update public.questions
        set mcq_bank_subfolder_id = p_mcq_bank_subfolder_id
        where id = v_question_id
          and mcq_bank_subfolder_id is null
          and mcq_bank_folder_id is null
          and deleted_at is null;
      end if;
      insert into public.import_rows (batch_id, row_number, outcome, question_id)
      values (p_batch_id, v_row_number, 'skipped_duplicate', v_question_id);
      continue;
    end if;

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

comment on function public.import_question_batch(uuid, jsonb, boolean, uuid) is
  'Bulk CSV import. Concurrent taxonomy/content-hash races reuse existing rows (skipped_duplicate for hash). New questions are always approved.';

revoke all on function public.import_question_batch(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_question_batch(uuid, jsonb, boolean, uuid) to authenticated, service_role;
