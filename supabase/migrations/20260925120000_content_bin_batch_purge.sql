-- Content Bin scale: paginated list + batched purge (keeps single-item purge_content).
-- Staging-first. Does not change single purge_content semantics.

-- ---------------------------------------------------------------------------
-- 1. Paginated bin list
-- ---------------------------------------------------------------------------
create or replace function public.list_content_bin_page(
  p_year_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  entity_type text,
  entity_id uuid,
  name text,
  year_id uuid,
  deleted_at timestamptz,
  purge_after timestamptz,
  deleted_by uuid,
  has_r2 boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'admin_only';
  end if;
  if not (
    public.has_permission('manage_materials')
    or public.has_permission('edit_questions')
  ) then
    raise exception 'permission_denied';
  end if;
  if p_year_id is not null and not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  return query
  with bin as (
    select 'material_folder'::text as entity_type, mf.id as entity_id, mf.name,
           mf.year_id, mf.deleted_at, mf.purge_after, mf.deleted_by, false as has_r2
    from public.material_folders mf
    where mf.deleted_at is not null
      and (p_year_id is null or mf.year_id = p_year_id)
      and public.admin_can_access_year(mf.year_id)
    union all
    select 'material'::text, m.id, m.title, mf2.year_id, m.deleted_at, m.purge_after, m.deleted_by,
           (m.r2_object_key is not null)
    from public.materials m
    join public.material_folders mf2 on mf2.id = m.folder_id
    where m.deleted_at is not null
      and (p_year_id is null or mf2.year_id = p_year_id)
      and public.admin_can_access_year(mf2.year_id)
    union all
    select 'pearl_point'::text, pp.id, left(pp.prompt, 200), pp.year_id,
           pp.deleted_at, pp.purge_after, pp.deleted_by, false
    from public.pearl_points pp
    where pp.deleted_at is not null
      and (p_year_id is null or pp.year_id = p_year_id)
      and public.admin_can_access_year(pp.year_id)
    union all
    select 'ospe_station'::text, os.id, os.title, os.year_id, os.deleted_at, os.purge_after, os.deleted_by,
           (os.r2_object_key is not null)
    from public.ospe_stations os
    where os.deleted_at is not null
      and (p_year_id is null or os.year_id = p_year_id)
      and public.admin_can_access_year(os.year_id)
    union all
    select 'question'::text, q.id, left(coalesce(qv.stem, 'Untitled'), 80), q.year_id,
           q.deleted_at, q.purge_after, q.deleted_by, false
    from public.questions q
    left join public.question_versions qv on qv.id = q.current_version_id
    where q.deleted_at is not null
      and (p_year_id is null or q.year_id = p_year_id)
      and public.admin_can_access_year(q.year_id)
    union all
    select 'prof_session_day'::text, psd.id, psd.name, psd.year_id,
           psd.deleted_at, psd.purge_after, psd.deleted_by, false
    from public.prof_session_days psd
    where psd.deleted_at is not null
      and (p_year_id is null or psd.year_id = p_year_id)
      and public.admin_can_access_year(psd.year_id)
    union all
    select 'one_liner'::text, ol.id, left(ol.title, 80), ol.year_id,
           ol.deleted_at, ol.purge_after, ol.deleted_by, false
    from public.one_liners ol
    where ol.deleted_at is not null
      and (p_year_id is null or ol.year_id = p_year_id)
      and public.admin_can_access_year(ol.year_id)
    union all
    select 'mcq_bank_folder'::text, mbf.id, mbf.name, mbf.year_id,
           mbf.deleted_at, mbf.purge_after, mbf.deleted_by, false
    from public.mcq_bank_folders mbf
    where mbf.deleted_at is not null
      and (p_year_id is null or mbf.year_id = p_year_id)
      and public.admin_can_access_year(mbf.year_id)
  ),
  ranked as (
    select
      b.*,
      count(*) over () as total_count,
      row_number() over (order by b.deleted_at desc nulls last, b.entity_id) as rn
    from bin b
  )
  select
    r.entity_type,
    r.entity_id,
    r.name,
    r.year_id,
    r.deleted_at,
    r.purge_after,
    r.deleted_by,
    r.has_r2,
    r.total_count
  from ranked r
  where r.rn > v_offset
    and r.rn <= v_offset + v_limit
  order by r.rn;
end;
$$;

comment on function public.list_content_bin_page(uuid, int, int) is
  'Paginated Content Bin listing. Cap limit 100. total_count is full match size.';

revoke execute on function public.list_content_bin_page(uuid, int, int) from public, anon;
grant execute on function public.list_content_bin_page(uuid, int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Batched purge — one RPC for up to 500 items; per-item outcomes
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
