-- Admin curriculum delete: protective leaf/empty-node deletion.
--
-- Product model (established from existing schema + content-bin rules, not subtree wipe):
-- - Curriculum hierarchy FKs already CASCADE for empty taxonomy children, but admin UI
--   must NOT silently cascade parents that still have children (accidental mass delete).
-- - Questions are NOT hard-deleted via curriculum DELETE: immutable question_versions
--   block CASCADE deletes from the topic→question path. Soft-deleted questions still hold
--   topic_id FKs until purged from the Content Bin (the only approved hard-delete path).
-- - Product subjects (product_key) are chrome anchors — never delete via Curriculum UI.
-- - Same pattern as admin_soft_delete_mcq_bank_folder: refuse when not empty.
--
-- Supported: delete an empty topic / chapter / book / departmental subject after
-- children and questions are removed. Raises snake_case business codes for the UI.

create or replace function public.admin_delete_curriculum_node(
  p_kind text,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_year uuid;
  v_name text;
  v_product_key text;
  v_child_label text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_curriculum') then
    raise exception 'permission_denied';
  end if;
  if p_id is null then
    raise exception 'curriculum_not_found';
  end if;
  if v_kind not in ('subjects', 'books', 'chapters', 'topics') then
    raise exception 'invalid_curriculum_kind';
  end if;

  if v_kind = 'topics' then
    select t.year_id, t.name into v_year, v_name
    from public.topics t where t.id = p_id;
    if v_year is null then
      raise exception 'curriculum_not_found';
    end if;
    if not public.admin_can_access_year(v_year) then
      raise exception 'year_scope_denied';
    end if;
    -- Any question row (live or soft-deleted) still references topic_id NOT NULL.
    if exists (select 1 from public.questions q where q.topic_id = p_id) then
      raise exception 'curriculum_has_questions';
    end if;
    delete from public.topics where id = p_id;

  elsif v_kind = 'chapters' then
    select c.year_id, c.name into v_year, v_name
    from public.chapters c where c.id = p_id;
    if v_year is null then
      raise exception 'curriculum_not_found';
    end if;
    if not public.admin_can_access_year(v_year) then
      raise exception 'year_scope_denied';
    end if;
    if exists (select 1 from public.topics t where t.chapter_id = p_id) then
      raise exception 'curriculum_has_children';
    end if;
    if exists (select 1 from public.questions q where q.chapter_id = p_id) then
      raise exception 'curriculum_has_questions';
    end if;
    delete from public.chapters where id = p_id;
    v_child_label := 'topics';

  elsif v_kind = 'books' then
    select b.year_id, b.name into v_year, v_name
    from public.books b where b.id = p_id;
    if v_year is null then
      raise exception 'curriculum_not_found';
    end if;
    if not public.admin_can_access_year(v_year) then
      raise exception 'year_scope_denied';
    end if;
    if exists (select 1 from public.chapters c where c.book_id = p_id) then
      raise exception 'curriculum_has_children';
    end if;
    if exists (select 1 from public.questions q where q.book_id = p_id) then
      raise exception 'curriculum_has_questions';
    end if;
    delete from public.books where id = p_id;
    v_child_label := 'chapters';

  else
    -- subjects
    select s.year_id, s.name, s.product_key into v_year, v_name, v_product_key
    from public.subjects s where s.id = p_id;
    if v_year is null then
      raise exception 'curriculum_not_found';
    end if;
    if not public.admin_can_access_year(v_year) then
      raise exception 'year_scope_denied';
    end if;
    if v_product_key is not null then
      raise exception 'product_subject_protected';
    end if;
    if exists (select 1 from public.books b where b.subject_id = p_id) then
      raise exception 'curriculum_has_children';
    end if;
    if exists (select 1 from public.questions q where q.subject_id = p_id) then
      raise exception 'curriculum_has_questions';
    end if;
    if exists (select 1 from public.tests t where t.subject_id = p_id) then
      raise exception 'curriculum_has_tests';
    end if;
    -- Soft-deleted rows still hold FKs until Content Bin purge — block those too.
    if exists (select 1 from public.material_folders mf where mf.subject_id = p_id) then
      raise exception 'curriculum_has_materials';
    end if;
    if exists (
      select 1 from public.mcq_bank_folders mbf
      where mbf.academic_product_subject_id = p_id
    ) then
      raise exception 'curriculum_has_mcq_folders';
    end if;
    if exists (select 1 from public.ospe_stations os where os.subject_id = p_id) then
      raise exception 'curriculum_has_ospe';
    end if;
    if exists (select 1 from public.prof_session_days d where d.subject_id = p_id) then
      raise exception 'curriculum_has_prof_session';
    end if;
    if exists (select 1 from public.pearl_points pp where pp.subject_id = p_id) then
      raise exception 'curriculum_has_pearls';
    end if;
    if exists (select 1 from public.one_liners ol where ol.subject_id = p_id) then
      raise exception 'curriculum_has_one_liners';
    end if;
    delete from public.subjects where id = p_id;
    v_child_label := 'books';
  end if;

  perform public.log_audit(
    'curriculum_node_deleted',
    v_kind,
    p_id,
    jsonb_build_object(
      'kind', v_kind,
      'name', v_name,
      'year_id', v_year,
      'child_label', v_child_label
    )
  );
end;
$$;

comment on function public.admin_delete_curriculum_node(text, uuid) is
  'Delete an empty curriculum node (subject/book/chapter/topic). Refuses parents with children, nodes with questions (incl. soft-deleted), product subjects, and subjects still linked to tests/materials/MCQ folders/OSPE/Prof Session/pearls/one-liners. Requires manage_curriculum.';

revoke execute on function public.admin_delete_curriculum_node(text, uuid) from public, anon;
grant execute on function public.admin_delete_curriculum_node(text, uuid) to authenticated, service_role;
