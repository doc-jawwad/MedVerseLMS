-- Fix question hard-purge: question_versions DELETE trigger blocks FK CASCADE.
-- Security-definer purge paths temporarily use session_replication_role=replica
-- (LOCAL) — same pattern documented for fixture cleanup in performance-baseline.md.
-- Does not weaken append-only for normal authenticated writes.

create or replace function public.purge_content(
  p_entity_type text,
  p_entity_id uuid
)
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
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day', 'one_liner', 'mcq_bank_folder'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type in ('question', 'mcq_bank_folder') then
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
      select year_id, name into v_year_id, v_name
      from public.material_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      for v_r2, v_cover in
        select m.r2_object_key, m.cover_object_key
        from public.materials m where m.folder_id = p_entity_id
      loop
        perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
        perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      end loop;
      delete from public.material_folders where id = p_entity_id;

    when 'material' then
      select f.year_id, m.title, m.r2_object_key, m.cover_object_key
        into v_year_id, v_name, v_r2, v_cover
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
      perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      delete from public.materials where id = p_entity_id;

    when 'pearl_point' then
      select year_id, left(prompt, 200) into v_year_id, v_name
      from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.pearl_points where id = p_entity_id;

    when 'ospe_station' then
      select year_id, title, r2_object_key into v_year_id, v_name, v_r2
      from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      perform public.enqueue_r2_purge(v_r2, 'ospe_station', p_entity_id);
      delete from public.ospe_stations where id = p_entity_id;

    when 'question' then
      select year_id, coalesce(stem_normalized, id::text) into v_year_id, v_name
      from public.questions where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      if exists (select 1 from public.test_questions where question_id = p_entity_id) then
        raise exception 'question_referenced_by_test';
      end if;
      -- Bypass append-only DELETE trigger only for this cascade (LOCAL).
      perform set_config('session_replication_role', 'replica', true);
      delete from public.questions where id = p_entity_id;
      perform set_config('session_replication_role', 'origin', true);

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
  end case;

  perform public.log_audit(
    'content_purged',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('name', v_name, 'year_id', v_year_id)
  );
end;
$$;

-- Patch batch question delete the same way (replace function body section via full replace).

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
      'question', 'prof_session_day', 'one_liner', 'mcq_bank_folder'
    );

  -- Permission short-circuit by type
  insert into _purge_batch_out (entity_type, entity_id, outcome, detail)
  select i.entity_type, i.entity_id, 'blocked', 'permission_denied'
  from _purge_batch_in i
  where (
    i.entity_type in ('question', 'mcq_bank_folder') and not v_can_questions
  ) or (
    i.entity_type not in ('question', 'mcq_bank_folder') and not v_can_materials
  )
  on conflict do nothing;

  -- ===================== QUESTIONS (set-based) =====================
  -- Missing / already hard-deleted
  insert into _purge_batch_out (entity_type, entity_id, outcome, detail)
  select i.entity_type, i.entity_id, 'already_gone', 'entity_not_found'
  from _purge_batch_in i
  where i.entity_type = 'question'
    and not exists (select 1 from public.questions q where q.id = i.entity_id)
    and not exists (
      select 1 from _purge_batch_out o
      where o.entity_type = i.entity_type and o.entity_id = i.entity_id
    );

  -- Not soft-deleted (not in bin) — idempotent skip
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

  -- Year scope
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

  -- Referenced by any test (authoritative guard)
  insert into _purge_batch_out (entity_type, entity_id, outcome, detail)
  select i.entity_type, i.entity_id, 'blocked', 'question_referenced_by_test'
  from _purge_batch_in i
  where i.entity_type = 'question'
    and exists (select 1 from public.test_questions tq where tq.question_id = i.entity_id)
    and not exists (
      select 1 from _purge_batch_out o
      where o.entity_type = i.entity_type and o.entity_id = i.entity_id
    );

  -- Purge remaining soft-deleted questions (set delete + audit).
  -- Bypass question_versions immutability trigger for CASCADE only (LOCAL).
  perform set_config('session_replication_role', 'replica', true);
  begin
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
    perform set_config('session_replication_role', 'origin', true);
    raise;
  end;
  perform set_config('session_replication_role', 'origin', true);

  -- ===================== Other entity types via existing purge_content =====================
  -- Reuse single-item RPC for non-question types (small volume in practice).
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
      -- Require soft-deleted for bin permanence (idempotent if already gone)
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
        else
          insert into _purge_batch_out values (r.entity_type, r.entity_id, 'blocked', 'invalid_entity_type')
          on conflict do nothing;
          continue;
      end case;

      perform public.purge_content(r.entity_type, r.entity_id);
      insert into _purge_batch_out values (r.entity_type, r.entity_id, 'purged', null)
      on conflict do nothing;
    exception when others then
      insert into _purge_batch_out values (r.entity_type, r.entity_id, 'blocked', SQLERRM)
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
  'Batch permanent Bin purge. Max 500 items. Returns per-item outcomes: purged|blocked|already_gone. R2 via enqueue_r2_purge. Idempotent retry.';

revoke execute on function public.purge_content_batch(jsonb) from public, anon;
grant execute on function public.purge_content_batch(jsonb) to authenticated, service_role;
