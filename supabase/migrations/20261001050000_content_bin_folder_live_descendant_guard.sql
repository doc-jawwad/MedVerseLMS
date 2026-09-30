-- Content Bin: refuse folder hard-delete when live descendants exist;
-- enqueue R2 keys for all materials in the folder subtree before CASCADE delete.

create or replace function public.folder_has_live_descendants(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select id from public.material_folders where id = p_folder_id
    union all
    select c.id
    from public.material_folders c
    join tree t on c.parent_id = t.id
  )
  select exists (
    select 1
    from public.material_folders f
    join tree t on t.id = f.id
    where f.id <> p_folder_id
      and f.deleted_at is null
  )
  or exists (
    select 1
    from public.materials m
    join tree t on t.id = m.folder_id
    where m.deleted_at is null
  );
$$;

revoke execute on function public.folder_has_live_descendants(uuid)
  from public, anon, authenticated;
grant execute on function public.folder_has_live_descendants(uuid)
  to authenticated, service_role;

comment on function public.folder_has_live_descendants(uuid) is
  'True when the folder subtree contains a live (non-soft-deleted) child folder or material. Blocks CASCADE hard-delete.';

create or replace function public.folder_subtree_r2_keys(p_folder_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select id from public.material_folders where id = p_folder_id
    union all
    select c.id
    from public.material_folders c
    join tree t on c.parent_id = t.id
  )
  select coalesce(array_agg(distinct k), '{}'::text[])
  from (
    select m.r2_object_key as k
    from public.materials m
    join tree t on t.id = m.folder_id
    where m.r2_object_key is not null
    union all
    select m.cover_object_key
    from public.materials m
    join tree t on t.id = m.folder_id
    where m.cover_object_key is not null
  ) s;
$$;

revoke execute on function public.folder_subtree_r2_keys(uuid)
  from public, anon, authenticated;
grant execute on function public.folder_subtree_r2_keys(uuid) to service_role;

-- Patch purge_content: material_folder guard + subtree R2 capture
create or replace function public.purge_content(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_name text;
  v_r2 text;
  v_cover text;
  v_library_type text;
  v_keys text[];
  v_key text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day', 'one_liner', 'mcq_bank_folder',
    'mcq_bank_subfolder'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type in ('question', 'mcq_bank_folder', 'mcq_bank_subfolder') then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
  else
    if not public.has_permission('manage_materials') then
      raise exception 'permission_denied';
    end if;
  end if;

  case p_entity_type
    when 'material_folder' then
      select year_id, name, library_type into v_year_id, v_name, v_library_type
      from public.material_folders where id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if v_library_type = 'career_counseling_series' then
        if v_year_id is not null then raise exception 'invalid_ccs_year_scope'; end if;
      else
        if v_year_id is null then raise exception 'entity_not_found'; end if;
        if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      end if;
      if public.folder_has_live_descendants(p_entity_id) then
        raise exception 'folder_has_live_descendants';
      end if;
      v_keys := public.folder_subtree_r2_keys(p_entity_id);
      delete from public.material_folders where id = p_entity_id;
      foreach v_key in array v_keys loop
        perform public.enqueue_r2_purge_if_unreferenced(v_key, 'material', p_entity_id);
      end loop;

    when 'material' then
      select f.year_id, m.title, m.r2_object_key, m.cover_object_key, f.library_type
        into v_year_id, v_name, v_r2, v_cover, v_library_type
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if v_library_type = 'career_counseling_series' then
        if v_year_id is not null then raise exception 'invalid_ccs_year_scope'; end if;
      else
        if v_year_id is null then raise exception 'entity_not_found'; end if;
        if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      end if;
      delete from public.materials where id = p_entity_id;
      perform public.enqueue_r2_purge_if_unreferenced(v_r2, 'material', p_entity_id);
      perform public.enqueue_r2_purge_if_unreferenced(v_cover, 'material', p_entity_id);

    when 'pearl_point' then
      select year_id, left(prompt, 200), r2_object_key
        into v_year_id, v_name, v_r2
      from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.pearl_points where id = p_entity_id;
      perform public.enqueue_r2_purge_if_unreferenced(v_r2, 'pearl_point', p_entity_id);

    when 'ospe_station' then
      select year_id, title, r2_object_key into v_year_id, v_name, v_r2
      from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.ospe_stations where id = p_entity_id;
      perform public.enqueue_r2_purge_if_unreferenced(v_r2, 'ospe_station', p_entity_id);

    when 'question' then
      select year_id, coalesce(stem_normalized, id::text) into v_year_id, v_name
      from public.questions where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      if exists (select 1 from public.test_questions where question_id = p_entity_id) then
        raise exception 'question_referenced_by_test';
      end if;
      perform set_config('medverse.allow_question_version_purge', '1', true);
      delete from public.practice_answers pa
      using public.question_versions qv
      where pa.question_version_id = qv.id
        and qv.question_id = p_entity_id;
      delete from public.questions where id = p_entity_id;
      perform set_config('medverse.allow_question_version_purge', '', true);

    when 'prof_session_day' then
      select year_id, name into v_year_id, v_name
      from public.prof_session_days where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.prof_session_days where id = p_entity_id;

    when 'one_liner' then
      select year_id, left(title, 200) into v_year_id, v_name
      from public.one_liners where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.one_liners where id = p_entity_id and deleted_at is not null;

    when 'mcq_bank_folder' then
      select year_id, name into v_year_id, v_name
      from public.mcq_bank_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.mcq_bank_folders where id = p_entity_id and deleted_at is not null;

    when 'mcq_bank_subfolder' then
      perform public.purge_mcq_bank_subfolder_content(p_entity_id);
      return;
  end case;

  perform public.log_audit(
    'content_purged',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('name', v_name, 'year_id', v_year_id)
  );
end;
$$;

comment on function public.purge_content(text, uuid) is
  'Hard-delete one Content Bin entity. Folder purge refuses live descendants; captures subtree R2 keys before CASCADE delete; enqueues only when unreferenced.';

-- Patch purge_expired_bin_items with the same folder guards
create or replace function public.purge_expired_bin_items()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_err text;
  r record;
  v_keys text[];
  v_key text;
begin
  -- Materials first so R2 is handled per-row before any folder CASCADE.
  for r in
    select m.id, m.r2_object_key, m.cover_object_key
    from public.materials m
    where m.deleted_at is not null
      and m.purge_after is not null
      and m.purge_after <= now()
  loop
    begin
      delete from public.materials where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'material', r.id);
      perform public.enqueue_r2_purge_if_unreferenced(r.cover_object_key, 'material', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired material %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('material %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select f.id
    from public.material_folders f
    where f.deleted_at is not null
      and f.purge_after is not null
      and f.purge_after <= now()
  loop
    begin
      if public.folder_has_live_descendants(r.id) then
        raise exception 'folder_has_live_descendants';
      end if;
      v_keys := public.folder_subtree_r2_keys(r.id);
      delete from public.material_folders where id = r.id;
      foreach v_key in array v_keys loop
        perform public.enqueue_r2_purge_if_unreferenced(v_key, 'material_folder', r.id);
      end loop;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired material_folder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('material_folder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id, r2_object_key from public.pearl_points
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.pearl_points where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'pearl_point', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired pearl_point %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('pearl_point %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id, r2_object_key from public.ospe_stations
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.ospe_stations where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'ospe_station', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired ospe_station %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('ospe_station %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.questions
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      if exists (
        select 1 from public.test_questions tq where tq.question_id = r.id
      ) then
        raise exception 'question_referenced_by_test';
      end if;
      perform set_config('medverse.allow_question_version_purge', '1', true);
      delete from public.practice_answers pa
      using public.question_versions qv
      where pa.question_version_id = qv.id
        and qv.question_id = r.id;
      delete from public.questions where id = r.id;
      perform set_config('medverse.allow_question_version_purge', '', true);
      v_count := v_count + 1;
    exception when others then
      perform set_config('medverse.allow_question_version_purge', '', true);
      raise notice 'purge_expired question %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('question %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.prof_session_days
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.prof_session_days where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired prof_session_day %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('prof_session_day %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.one_liners
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.one_liners where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired one_liner %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('one_liner %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.mcq_bank_subfolders
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      if exists (
        select 1 from public.questions q
        where q.mcq_bank_subfolder_id = r.id and q.deleted_at is null
      ) then
        raise exception 'subfolder_not_empty';
      end if;
      delete from public.mcq_bank_subfolders where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired mcq_bank_subfolder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('mcq_bank_subfolder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.mcq_bank_folders
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.mcq_bank_folders where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired mcq_bank_folder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('mcq_bank_folder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  insert into public.purge_log (deleted_count, error_text)
  values (v_count, v_err);
end;
$$;

comment on function public.purge_expired_bin_items() is
  'Cron hard-delete for Bin rows where purge_after <= now(). Materials first; folders refuse live descendants and enqueue subtree R2 keys before CASCADE.';
