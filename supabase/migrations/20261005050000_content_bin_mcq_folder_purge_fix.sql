-- Fix Content Bin permanent delete for MCQ Bank folders.
-- Root cause: mcq_bank_subfolders.folder_id is FK NO ACTION, so
-- purge_content('mcq_bank_folder') failed with a Postgres FK error when
-- soft-deleted subfolders still referenced the folder. The app mapped that
-- internal error to "Something went wrong. Please try again."
--
-- Fix (material-folder analog, does not weaken question/test retention):
-- 1) refuse while LIVE subfolders/questions remain (mcq_bank_folder_not_empty)
-- 2) hard-delete soft-deleted child subfolders first (questions SET NULL)
-- 3) then hard-delete the folder
-- Also: purge_content_batch accepts mcq_bank_subfolder (was missing).

-- ---------------------------------------------------------------------------
-- Dedicated folder purge helper (mirrors purge_mcq_bank_subfolder_content)
-- ---------------------------------------------------------------------------
create or replace function public.purge_mcq_bank_folder_content(p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_name text;
begin
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;

  select year_id, name into v_year_id, v_name
  from public.mcq_bank_folders
  where id = p_entity_id and deleted_at is not null;
  if v_year_id is null then
    raise exception 'entity_not_found';
  end if;
  if not public.admin_can_access_year(v_year_id) then
    raise exception 'year_scope_denied';
  end if;

  -- Live children must be soft-deleted first (Main Admin cascade).
  if exists (
    select 1 from public.mcq_bank_subfolders
    where folder_id = p_entity_id and deleted_at is null
  ) or exists (
    select 1 from public.questions q
    where q.deleted_at is null
      and (
        q.mcq_bank_folder_id = p_entity_id
        or q.mcq_bank_subfolder_id in (
          select s.id from public.mcq_bank_subfolders s
          where s.folder_id = p_entity_id
        )
      )
  ) then
    raise exception 'mcq_bank_folder_not_empty';
  end if;

  -- Soft-deleted subfolders FK-block folder DELETE (NO ACTION).
  -- Questions reference subfolders/folders with ON DELETE SET NULL and remain
  -- as separate Bin rows (still subject to question_referenced_by_test).
  delete from public.mcq_bank_subfolders
  where folder_id = p_entity_id
    and deleted_at is not null;

  delete from public.mcq_bank_folders
  where id = p_entity_id
    and deleted_at is not null;

  perform public.log_audit(
    'content_purged',
    'mcq_bank_folder',
    p_entity_id,
    jsonb_build_object('name', v_name, 'year_id', v_year_id)
  );
end;
$$;

comment on function public.purge_mcq_bank_folder_content(uuid) is
  'Hard-delete a soft-deleted MCQ Bank folder. Refuses live descendants; deletes soft-deleted child subfolders first (FK NO ACTION); questions SET NULL and stay in Bin until purged separately.';

revoke execute on function public.purge_mcq_bank_folder_content(uuid) from public, anon;
grant execute on function public.purge_mcq_bank_folder_content(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- purge_content: delegate mcq_bank_folder to helper
-- ---------------------------------------------------------------------------
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
      perform public.purge_mcq_bank_folder_content(p_entity_id);
      return;

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
  'Hard-delete one Content Bin entity. MCQ folder path refuses live descendants and deletes soft-deleted child subfolders before folder DELETE. Question path raises question_referenced_by_test unchanged.';

-- ---------------------------------------------------------------------------
-- purge_content_batch: include mcq_bank_subfolder + edit_questions permission
-- ---------------------------------------------------------------------------
create or replace function public.purge_content_batch(p_items jsonb)
returns table (
  entity_type text,
  entity_id uuid,
  outcome text,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_can_questions boolean;
  v_can_materials boolean;
  v_n int;
  r record;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  v_can_questions := public.has_permission('edit_questions');
  v_can_materials := public.has_permission('manage_materials');
  if not (v_can_questions or v_can_materials) then
    raise exception 'permission_denied';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items';
  end if;

  v_n := jsonb_array_length(p_items);
  if v_n = 0 then
    return;
  end if;
  if v_n > 500 then
    raise exception 'batch_too_large';
  end if;

  create temporary table if not exists _purge_batch_in (
    entity_type text not null,
    entity_id uuid not null,
    primary key (entity_type, entity_id)
  ) on commit drop;
  truncate _purge_batch_in;

  create temporary table if not exists _purge_batch_out (
    entity_type text not null,
    entity_id uuid not null,
    outcome text not null,
    detail text,
    primary key (entity_type, entity_id)
  ) on commit drop;
  truncate _purge_batch_out;

  insert into _purge_batch_in (entity_type, entity_id)
  select distinct
    x.entity_type,
    x.entity_id
  from jsonb_to_recordset(p_items) as x(entity_type text, entity_id uuid)
  where x.entity_type is not null
    and x.entity_id is not null
    and x.entity_type in (
      'material_folder', 'material', 'pearl_point', 'ospe_station',
      'question', 'prof_session_day', 'one_liner', 'mcq_bank_folder',
      'mcq_bank_subfolder'
    );

  insert into _purge_batch_out (entity_type, entity_id, outcome, detail)
  select i.entity_type, i.entity_id, 'blocked', 'permission_denied'
  from _purge_batch_in i
  where (
    i.entity_type in ('question', 'mcq_bank_folder', 'mcq_bank_subfolder')
    and not v_can_questions
  ) or (
    i.entity_type not in ('question', 'mcq_bank_folder', 'mcq_bank_subfolder')
    and not v_can_materials
  )
  on conflict do nothing;

  -- Questions (set-based) — unchanged guards
  insert into _purge_batch_out (entity_type, entity_id, outcome, detail)
  select i.entity_type, i.entity_id, 'already_gone', 'entity_not_found'
  from _purge_batch_in i
  where i.entity_type = 'question'
    and not exists (select 1 from public.questions q where q.id = i.entity_id)
    and not exists (
      select 1 from _purge_batch_out o
      where o.entity_type = i.entity_type and o.entity_id = i.entity_id
    );

  insert into _purge_batch_out (entity_type, entity_id, outcome, detail)
  select i.entity_type, i.entity_id, 'already_gone', 'not_in_bin'
  from _purge_batch_in i
  join public.questions q on q.id = i.entity_id
  where i.entity_type = 'question'
    and q.deleted_at is null
    and not exists (
      select 1 from _purge_batch_out o
      where o.entity_type = i.entity_type and o.entity_id = i.entity_id
    );

  insert into _purge_batch_out (entity_type, entity_id, outcome, detail)
  select i.entity_type, i.entity_id, 'blocked', 'year_scope_denied'
  from _purge_batch_in i
  join public.questions q on q.id = i.entity_id
  where i.entity_type = 'question'
    and q.deleted_at is not null
    and not public.admin_can_access_year(q.year_id)
    and not exists (
      select 1 from _purge_batch_out o
      where o.entity_type = i.entity_type and o.entity_id = i.entity_id
    );

  insert into _purge_batch_out (entity_type, entity_id, outcome, detail)
  select i.entity_type, i.entity_id, 'blocked', 'question_referenced_by_test'
  from _purge_batch_in i
  where i.entity_type = 'question'
    and exists (select 1 from public.test_questions tq where tq.question_id = i.entity_id)
    and not exists (
      select 1 from _purge_batch_out o
      where o.entity_type = i.entity_type and o.entity_id = i.entity_id
    );

  perform set_config('medverse.allow_question_version_purge', '1', true);
  begin
    delete from public.practice_answers pa
    using public.question_versions qv
    where pa.question_version_id = qv.id
      and qv.question_id in (
        select q.id
        from _purge_batch_in i
        join public.questions q on q.id = i.entity_id
        where i.entity_type = 'question'
          and q.deleted_at is not null
          and not exists (
            select 1 from _purge_batch_out o
            where o.entity_type = 'question' and o.entity_id = i.entity_id
          )
      );

    for r in
      with deletable as (
        select q.id, q.year_id, coalesce(q.stem_normalized, q.id::text) as name
        from _purge_batch_in i
        join public.questions q on q.id = i.entity_id
        where i.entity_type = 'question'
          and q.deleted_at is not null
          and not exists (
            select 1 from _purge_batch_out o
            where o.entity_type = 'question' and o.entity_id = i.entity_id
          )
      )
      delete from public.questions q
      using deletable d
      where q.id = d.id
      returning d.id as entity_id, d.year_id, d.name
    loop
      perform public.log_audit(
        'content_purged',
        'question',
        r.entity_id,
        jsonb_build_object('name', r.name, 'year_id', r.year_id, 'batch', true)
      );
      insert into _purge_batch_out values ('question', r.entity_id, 'purged', null)
      on conflict do nothing;
    end loop;
  exception when others then
    perform set_config('medverse.allow_question_version_purge', '', true);
    raise;
  end;
  perform set_config('medverse.allow_question_version_purge', '', true);

  -- Non-question entities via purge_content (includes mcq_bank_subfolder)
  for r in
    select i.entity_type, i.entity_id
    from _purge_batch_in i
    where i.entity_type <> 'question'
      and not exists (
        select 1 from _purge_batch_out o
        where o.entity_type = i.entity_type and o.entity_id = i.entity_id
      )
  loop
    begin
      case r.entity_type
        when 'material_folder' then
          if not exists (select 1 from public.material_folders where id = r.entity_id and deleted_at is not null) then
            insert into _purge_batch_out values (r.entity_type, r.entity_id, 'already_gone', 'not_in_bin')
            on conflict do nothing;
            continue;
          end if;
        when 'material' then
          if not exists (select 1 from public.materials where id = r.entity_id and deleted_at is not null) then
            insert into _purge_batch_out values (r.entity_type, r.entity_id, 'already_gone', 'not_in_bin')
            on conflict do nothing;
            continue;
          end if;
        when 'pearl_point' then
          if not exists (select 1 from public.pearl_points where id = r.entity_id and deleted_at is not null) then
            insert into _purge_batch_out values (r.entity_type, r.entity_id, 'already_gone', 'not_in_bin')
            on conflict do nothing;
            continue;
          end if;
        when 'ospe_station' then
          if not exists (select 1 from public.ospe_stations where id = r.entity_id and deleted_at is not null) then
            insert into _purge_batch_out values (r.entity_type, r.entity_id, 'already_gone', 'not_in_bin')
            on conflict do nothing;
            continue;
          end if;
        when 'prof_session_day' then
          if not exists (select 1 from public.prof_session_days where id = r.entity_id and deleted_at is not null) then
            insert into _purge_batch_out values (r.entity_type, r.entity_id, 'already_gone', 'not_in_bin')
            on conflict do nothing;
            continue;
          end if;
        when 'one_liner' then
          if not exists (select 1 from public.one_liners where id = r.entity_id and deleted_at is not null) then
            insert into _purge_batch_out values (r.entity_type, r.entity_id, 'already_gone', 'not_in_bin')
            on conflict do nothing;
            continue;
          end if;
        when 'mcq_bank_folder' then
          if not exists (select 1 from public.mcq_bank_folders where id = r.entity_id and deleted_at is not null) then
            insert into _purge_batch_out values (r.entity_type, r.entity_id, 'already_gone', 'not_in_bin')
            on conflict do nothing;
            continue;
          end if;
        when 'mcq_bank_subfolder' then
          if not exists (select 1 from public.mcq_bank_subfolders where id = r.entity_id and deleted_at is not null) then
            insert into _purge_batch_out values (r.entity_type, r.entity_id, 'already_gone', 'not_in_bin')
            on conflict do nothing;
            continue;
          end if;
        else
          insert into _purge_batch_out values (r.entity_type, r.entity_id, 'blocked', 'invalid_entity_type')
          on conflict do nothing;
          continue;
      end case;

      perform public.purge_content(r.entity_type, r.entity_id);
      insert into _purge_batch_out values (r.entity_type, r.entity_id, 'purged', null)
      on conflict do nothing;
    exception when others then
      insert into _purge_batch_out values (
        r.entity_type, r.entity_id, 'blocked', left(sqlerrm, 200)
      )
      on conflict do nothing;
    end;
  end loop;

  return query
    select o.entity_type, o.entity_id, o.outcome, o.detail
    from _purge_batch_out o
    order by o.entity_type, o.entity_id;
end;
$$;

comment on function public.purge_content_batch(jsonb) is
  'Batched Content Bin hard-delete (max 500). Includes mcq_bank_subfolder. Per-item purged/blocked/already_gone.';

revoke execute on function public.purge_content_batch(jsonb) from public, anon;
grant execute on function public.purge_content_batch(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- purge_expired: same folder soft-child cleanup before folder DELETE
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_bin_items()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_retained_count int := 0;
  v_err text;
  v_retained text;
  r record;
  v_keys text[];
  v_key text;
begin
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
    if exists (
      select 1 from public.test_questions tq where tq.question_id = r.id
    ) then
      v_retained_count := v_retained_count + 1;
      v_retained := coalesce(v_retained || '; ', '')
        || format('question %s: question_referenced_by_test', r.id);
    else
      begin
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
    end if;
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
      if exists (
        select 1 from public.mcq_bank_subfolders
        where folder_id = r.id and deleted_at is null
      ) or exists (
        select 1 from public.questions q
        where q.deleted_at is null
          and (
            q.mcq_bank_folder_id = r.id
            or q.mcq_bank_subfolder_id in (
              select s.id from public.mcq_bank_subfolders s where s.folder_id = r.id
            )
          )
      ) then
        raise exception 'mcq_bank_folder_not_empty';
      end if;
      -- Remaining soft-deleted subfolders (e.g. not yet independently eligible)
      delete from public.mcq_bank_subfolders
      where folder_id = r.id and deleted_at is not null;
      delete from public.mcq_bank_folders where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired mcq_bank_folder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('mcq_bank_folder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  insert into public.purge_log (deleted_count, error_text, retained_count, retained_text)
  values (v_count, v_err, v_retained_count, v_retained);
end;
$$;

comment on function public.purge_expired_bin_items() is
  'Cron hard-delete where purge_after <= now(). MCQ folders refuse live descendants and delete soft-deleted child subfolders before folder DELETE. Questions with test_questions retained (retained_*).';
