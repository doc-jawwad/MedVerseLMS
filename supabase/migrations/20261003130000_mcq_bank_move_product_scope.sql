-- Seal cross-folder MCQ Move to same academic product subject (year already checked).
-- Does not change placement mechanics (NULL then dest) or widen authorization.

create or replace function public.admin_bulk_move_mcq_bank_subfolder_questions(
  p_source_subfolder_id uuid,
  p_dest_subfolder_id uuid,
  p_question_ids uuid[] default null,
  p_all_in_source boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.mcq_bank_subfolders%rowtype;
  v_dst public.mcq_bank_subfolders%rowtype;
  v_src_product uuid;
  v_dst_product uuid;
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
  if p_source_subfolder_id is null or p_dest_subfolder_id is null then
    raise exception 'subfolder_required';
  end if;
  if p_source_subfolder_id = p_dest_subfolder_id then
    raise exception 'same_subfolder';
  end if;
  if coalesce(p_all_in_source, false) and p_question_ids is not null and cardinality(p_question_ids) > 0 then
    raise exception 'move_selection_ambiguous';
  end if;
  if not coalesce(p_all_in_source, false)
     and (p_question_ids is null or cardinality(p_question_ids) = 0) then
    raise exception 'no_questions_selected';
  end if;

  select * into v_src
  from public.mcq_bank_subfolders
  where id = p_source_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_src.year_id) then
    raise exception 'year_scope_denied';
  end if;

  select * into v_dst
  from public.mcq_bank_subfolders
  where id = p_dest_subfolder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_dst.year_id) then
    raise exception 'year_scope_denied';
  end if;
  if v_dst.year_id is distinct from v_src.year_id then
    raise exception 'mcq_bank_subfolder_year_mismatch';
  end if;

  select f.academic_product_subject_id into v_src_product
  from public.mcq_bank_folders f
  where f.id = v_src.folder_id and f.deleted_at is null;
  if v_src_product is null then
    raise exception 'mcq_bank_folder_not_found';
  end if;

  select f.academic_product_subject_id into v_dst_product
  from public.mcq_bank_folders f
  where f.id = v_dst.folder_id and f.deleted_at is null;
  if v_dst_product is null then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if v_dst_product is distinct from v_src_product then
    raise exception 'mcq_bank_product_mismatch';
  end if;

  if coalesce(p_all_in_source, false) then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id), '{}')
    into v_ids
    from public.questions q
    where q.mcq_bank_subfolder_id = p_source_subfolder_id
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
      and q.mcq_bank_subfolder_id = p_source_subfolder_id
  ) is distinct from v_expected then
    raise exception 'question_not_in_source_subfolder';
  end if;

  perform 1 from public.questions q where q.id = any (v_ids) for update of q;

  update public.questions
  set mcq_bank_subfolder_id = null
  where id = any (v_ids)
    and mcq_bank_subfolder_id = p_source_subfolder_id
    and deleted_at is null;

  get diagnostics v_moved = row_count;
  if v_moved is distinct from v_expected then
    raise exception 'move_partial_aborted';
  end if;

  update public.questions
  set mcq_bank_subfolder_id = p_dest_subfolder_id
  where id = any (v_ids)
    and mcq_bank_subfolder_id is null
    and deleted_at is null;

  get diagnostics v_moved = row_count;
  if v_moved is distinct from v_expected then
    raise exception 'move_partial_aborted';
  end if;

  perform public.log_audit(
    'mcq_bulk_moved_subfolder',
    'mcq_bank_subfolder',
    p_dest_subfolder_id,
    jsonb_build_object(
      'source_subfolder_id', p_source_subfolder_id,
      'dest_subfolder_id', p_dest_subfolder_id,
      'moved', v_moved,
      'all_in_source', coalesce(p_all_in_source, false)
    )
  );

  return jsonb_build_object(
    'moved', v_moved,
    'source_subfolder_id', p_source_subfolder_id,
    'dest_subfolder_id', p_dest_subfolder_id,
    'question_ids', to_jsonb(v_ids)
  );
end;
$$;

comment on function public.admin_bulk_move_mcq_bank_subfolder_questions(uuid, uuid, uuid[], boolean) is
  'Atomic subfolder→subfolder Move (NULL then dest). Same year + same academic product subject. Preserves question ids/versions.';
