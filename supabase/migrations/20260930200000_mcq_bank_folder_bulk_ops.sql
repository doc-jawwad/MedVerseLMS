-- Academic MCQ Bank: atomic bulk folder→folder move, bulk unassign, folder-scoped bulk soft-delete.
-- Does not seed Source folders. Does not weaken protect_question_mcq_bank_folder (move uses NULL→dest in one txn).

-- ---------------------------------------------------------------------------
-- 1. Atomic bulk move (source folder → destination folder)
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_move_mcq_bank_folder_questions(
  p_source_folder_id uuid,
  p_dest_folder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_source boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.mcq_bank_folders%rowtype;
  v_dst public.mcq_bank_folders%rowtype;
  v_ids uuid[];
  v_expected int;
  v_moved int;
  v_max int := 2000;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;

  if p_source_folder_id is null or p_dest_folder_id is null then
    raise exception 'folder_required';
  end if;
  if p_source_folder_id = p_dest_folder_id then
    raise exception 'same_folder';
  end if;
  if coalesce(p_all_in_source, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'move_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_source, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_src
  from public.mcq_bank_folders
  where id = p_source_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_src.year_id) then
    raise exception 'year_scope_denied';
  end if;

  select * into v_dst
  from public.mcq_bank_folders
  where id = p_dest_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_dst.year_id) then
    raise exception 'year_scope_denied';
  end if;
  if v_dst.year_id is distinct from v_src.year_id then
    raise exception 'mcq_bank_folder_year_mismatch';
  end if;

  if coalesce(p_all_in_source, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_folder_id = p_source_folder_id
      and q.deleted_at is null;
  else
    -- Deduplicate while preserving caller order intent is unnecessary; set semantics.
    select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(p_question_ids) as x;
  end if;

  v_expected := cardinality(v_ids);
  if v_expected = 0 then
    raise exception 'no_questions_selected';
  end if;
  if v_expected > v_max then
    raise exception 'batch_too_large';
  end if;

  -- All-or-nothing: every id must currently live in the source folder.
  if (
    select count(*)::int
    from public.questions q
    where q.id = any (v_ids)
      and q.deleted_at is null
      and q.mcq_bank_folder_id = p_source_folder_id
  ) is distinct from v_expected then
    raise exception 'question_not_in_source_folder';
  end if;

  -- Lock rows, then NULL → dest (trigger allows each step; forbids direct A→B).
  perform 1
  from public.questions q
  where q.id = any (v_ids)
  for update of q;

  update public.questions
  set mcq_bank_folder_id = null
  where id = any (v_ids)
    and mcq_bank_folder_id = p_source_folder_id
    and deleted_at is null;

  get diagnostics v_moved = row_count;
  if v_moved is distinct from v_expected then
    raise exception 'move_partial_aborted';
  end if;

  update public.questions
  set mcq_bank_folder_id = p_dest_folder_id
  where id = any (v_ids)
    and mcq_bank_folder_id is null
    and deleted_at is null;

  get diagnostics v_moved = row_count;
  if v_moved is distinct from v_expected then
    raise exception 'move_partial_aborted';
  end if;

  perform public.log_audit(
    'mcq_bulk_moved_folder',
    'mcq_bank_folder',
    p_dest_folder_id,
    jsonb_build_object(
      'source_folder_id', p_source_folder_id,
      'dest_folder_id', p_dest_folder_id,
      'moved', v_moved,
      'all_in_source', coalesce(p_all_in_source, false)
    )
  );

  return jsonb_build_object(
    'moved', v_moved,
    'source_folder_id', p_source_folder_id,
    'dest_folder_id', p_dest_folder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

comment on function public.admin_bulk_move_mcq_bank_folder_questions(uuid, uuid, uuid[], boolean) is
  'Atomic Academic MCQ Bank folder→folder move. Preserves question ids. All-or-nothing; max 2000 per call. Requires edit_questions + year scope.';

revoke execute on function public.admin_bulk_move_mcq_bank_folder_questions(uuid, uuid, uuid[], boolean)
  from public, anon;
grant execute on function public.admin_bulk_move_mcq_bank_folder_questions(uuid, uuid, uuid[], boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Bulk unassign (remove from folder; question stays in Question Bank)
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_remove_questions_from_mcq_bank_folder(
  p_folder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_folder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
  v_ids uuid[];
  v_expected int;
  v_removed int;
  v_max int := 2000;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if p_folder_id is null then
    raise exception 'folder_required';
  end if;
  if coalesce(p_all_in_folder, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'remove_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_folder, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_folder
  from public.mcq_bank_folders
  where id = p_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_folder.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if coalesce(p_all_in_folder, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_folder_id = p_folder_id
      and q.deleted_at is null;
  else
    select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(p_question_ids) as x;
  end if;

  v_expected := cardinality(v_ids);
  if v_expected = 0 then
    raise exception 'no_questions_selected';
  end if;
  if v_expected > v_max then
    raise exception 'batch_too_large';
  end if;

  if (
    select count(*)::int
    from public.questions q
    where q.id = any (v_ids)
      and q.deleted_at is null
      and q.mcq_bank_folder_id = p_folder_id
  ) is distinct from v_expected then
    raise exception 'question_not_in_folder';
  end if;

  update public.questions
  set mcq_bank_folder_id = null
  where id = any (v_ids)
    and mcq_bank_folder_id = p_folder_id
    and deleted_at is null;

  get diagnostics v_removed = row_count;
  if v_removed is distinct from v_expected then
    raise exception 'remove_partial_aborted';
  end if;

  perform public.log_audit(
    'mcq_bulk_removed_from_folder',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object(
      'folder_id', p_folder_id,
      'removed', v_removed,
      'all_in_folder', coalesce(p_all_in_folder, false)
    )
  );

  return jsonb_build_object(
    'removed', v_removed,
    'folder_id', p_folder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

comment on function public.admin_bulk_remove_questions_from_mcq_bank_folder(uuid, uuid[], boolean) is
  'Bulk unassign questions from an Academic MCQ Bank folder (keeps questions in Question Bank). All-or-nothing; max 2000.';

revoke execute on function public.admin_bulk_remove_questions_from_mcq_bank_folder(uuid, uuid[], boolean)
  from public, anon;
grant execute on function public.admin_bulk_remove_questions_from_mcq_bank_folder(uuid, uuid[], boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Folder-scoped bulk soft-delete (Content Bin) — year-scoped, bounded
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_soft_delete_folder_questions(
  p_folder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_folder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.mcq_bank_folders%rowtype;
  v_ids uuid[];
  v_id uuid;
  v_expected int;
  v_binned int := 0;
  v_blocked int := 0;
  v_not_found int := 0;
  v_blocked_ids uuid[] := '{}';
  v_max int := 2000;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;
  if p_folder_id is null then
    raise exception 'folder_required';
  end if;
  if coalesce(p_all_in_folder, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'delete_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_folder, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_folder
  from public.mcq_bank_folders
  where id = p_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_folder.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if coalesce(p_all_in_folder, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_folder_id = p_folder_id
      and q.deleted_at is null;
  else
    select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(p_question_ids) as x;
  end if;

  v_expected := cardinality(v_ids);
  if v_expected = 0 then
    raise exception 'no_questions_selected';
  end if;
  if v_expected > v_max then
    raise exception 'batch_too_large';
  end if;

  foreach v_id in array v_ids loop
    if not exists (
      select 1 from public.questions q
      where q.id = v_id
        and q.deleted_at is null
        and q.mcq_bank_folder_id = p_folder_id
    ) then
      v_not_found := v_not_found + 1;
      continue;
    end if;

    if exists (
      select 1 from public.test_questions tq
      join public.tests t on t.id = tq.test_id
      where tq.question_id = v_id
        and t.status not in ('draft', 'archived', 'invalidated')
    ) then
      v_blocked := v_blocked + 1;
      v_blocked_ids := v_blocked_ids || v_id;
      continue;
    end if;

    update public.questions
    set deleted_at = now(),
        purge_after = now() + interval '7 days',
        deleted_by = auth.uid()
    where id = v_id
      and mcq_bank_folder_id = p_folder_id
      and deleted_at is null;

    if found then
      v_binned := v_binned + 1;
    end if;
  end loop;

  perform public.log_audit(
    'mcq_bulk_soft_deleted_from_folder',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object(
      'folder_id', p_folder_id,
      'binned', v_binned,
      'blocked_active_test', v_blocked,
      'not_found', v_not_found,
      'all_in_folder', coalesce(p_all_in_folder, false)
    )
  );

  return jsonb_build_object(
    'binned', v_binned,
    'blocked_active_test', v_blocked,
    'not_found', v_not_found,
    'blocked_ids', to_jsonb(v_blocked_ids),
    'folder_id', p_folder_id
  );
end;
$$;

comment on function public.admin_bulk_soft_delete_folder_questions(uuid, uuid[], boolean) is
  'Soft-delete (Content Bin) questions currently in an Academic MCQ Bank folder. Year-scoped; blocks active-test refs; max 2000. Does not unassign-only.';

revoke execute on function public.admin_bulk_soft_delete_folder_questions(uuid, uuid[], boolean)
  from public, anon;
grant execute on function public.admin_bulk_soft_delete_folder_questions(uuid, uuid[], boolean)
  to authenticated, service_role;
