-- Optional private source PDF on Prof. Session one_liners (pearl item-PDF pattern).
-- study-content/ R2 + authorize_one_liner_object + Content Bin R2 enqueue.
-- Does not merge into pearl_points or academic library_type = 'one_liner' folders.

-- ---------------------------------------------------------------------------
-- Optional PDF columns
-- ---------------------------------------------------------------------------
alter table public.one_liners
  add column if not exists r2_object_key text,
  add column if not exists r2_content_type text,
  add column if not exists r2_byte_size int;

alter table public.one_liners
  drop constraint if exists one_liners_r2_object_key_check;
alter table public.one_liners
  add constraint one_liners_r2_object_key_check
  check (
    r2_object_key is null
    or (
      r2_object_key ~ '^study-content/'
      and r2_object_key !~ '[[:space:]]'
    )
  );

alter table public.one_liners
  drop constraint if exists one_liners_r2_content_type_check;
alter table public.one_liners
  add constraint one_liners_r2_content_type_check
  check (
    r2_content_type is null
    or r2_content_type = 'application/pdf'
  );

alter table public.one_liners
  drop constraint if exists one_liners_r2_byte_size_check;
alter table public.one_liners
  add constraint one_liners_r2_byte_size_check
  check (
    r2_byte_size is null
    or r2_byte_size > 0
  );

alter table public.one_liners
  drop constraint if exists one_liners_r2_payload_check;
alter table public.one_liners
  add constraint one_liners_r2_payload_check
  check (
    (r2_object_key is null and r2_content_type is null and r2_byte_size is null)
    or (
      r2_object_key is not null
      and r2_content_type = 'application/pdf'
      and r2_byte_size is not null
      and r2_byte_size > 0
    )
  );

comment on column public.one_liners.r2_object_key is
  'Optional private R2 study-content/ PDF. Hidden from student SELECT; authorize_one_liner_object + Next.js private stream.';

alter table public.one_liners
  drop column if exists has_source_pdf;
alter table public.one_liners
  add column has_source_pdf boolean
  generated always as (r2_object_key is not null) stored;

comment on column public.one_liners.has_source_pdf is
  'Derived: optional source PDF attached. Safe for student catalog SELECT.';

-- Harden SELECT: table-level grant would expose r2_* keys. Column list only.
-- Keep deleted_at / purge_* for admin Bin (RLS still hides soft-deleted rows from students).
revoke select on public.one_liners from public;
revoke select on public.one_liners from anon;
revoke select on public.one_liners from authenticated;
grant select (
  id,
  tenant_id,
  title,
  body,
  year_id,
  subject_id,
  chapter_id,
  topic_id,
  status,
  sort_order,
  created_by,
  created_at,
  updated_at,
  deleted_at,
  purge_after,
  deleted_by,
  prof_session_day_id,
  has_source_pdf
) on public.one_liners to authenticated;
grant select (
  id,
  tenant_id,
  title,
  body,
  year_id,
  subject_id,
  chapter_id,
  topic_id,
  status,
  sort_order,
  created_by,
  created_at,
  updated_at,
  deleted_at,
  purge_after,
  deleted_by,
  prof_session_day_id,
  has_source_pdf
) on public.one_liners to anon;

-- ---------------------------------------------------------------------------
-- Authorize PDF object key (admin or enrolled student for published row)
-- Mirrors one_liners student RLS — not pearl entitlement.
-- ---------------------------------------------------------------------------
create or replace function public.authorize_one_liner_object(p_one_liner_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.one_liners%rowtype;
begin
  select * into v_row from public.one_liners where id = p_one_liner_id;
  if not found or v_row.r2_object_key is null or v_row.deleted_at is not null then
    raise exception 'one_liner_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_can_access_year(v_row.year_id) then
      raise exception 'one_liner_object_denied';
    end if;
    return v_row.r2_object_key;
  end if;

  if v_row.status is distinct from 'published' then
    raise exception 'one_liner_object_denied';
  end if;

  if not public.has_active_enrollment(v_row.year_id) then
    raise exception 'one_liner_object_denied';
  end if;

  return v_row.r2_object_key;
end;
$$;

revoke execute on function public.authorize_one_liner_object(uuid) from public, anon;
grant execute on function public.authorize_one_liner_object(uuid) to authenticated, service_role;

comment on function public.authorize_one_liner_object(uuid) is
  'Returns study-content/ object key for a one_liner PDF when admin (manage_materials + year) or enrolled student viewing a published non-deleted row.';

-- ---------------------------------------------------------------------------
-- Admin metadata (includes private r2 fields for attach/replace/clear)
-- ---------------------------------------------------------------------------
create or replace function public.get_one_liner_for_admin(p_one_liner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.one_liners%rowtype;
begin
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.one_liners where id = p_one_liner_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'body', v_row.body,
    'year_id', v_row.year_id,
    'subject_id', v_row.subject_id,
    'chapter_id', v_row.chapter_id,
    'topic_id', v_row.topic_id,
    'status', v_row.status,
    'sort_order', v_row.sort_order,
    'prof_session_day_id', v_row.prof_session_day_id,
    'has_source_pdf', (v_row.r2_object_key is not null),
    'r2_byte_size', v_row.r2_byte_size,
    'r2_object_key', v_row.r2_object_key
  );
end;
$$;

revoke execute on function public.get_one_liner_for_admin(uuid) from public, anon;
grant execute on function public.get_one_liner_for_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared R2 reference check includes one_liners
-- ---------------------------------------------------------------------------
create or replace function public.r2_object_still_referenced(p_object_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_object_key is null or p_object_key = '' then false
    else exists (
      select 1 from public.materials m
      where m.r2_object_key = p_object_key or m.cover_object_key = p_object_key
      union all
      select 1 from public.ospe_stations o where o.r2_object_key = p_object_key
      union all
      select 1 from public.pearl_points p where p.r2_object_key = p_object_key
      union all
      select 1 from public.one_liners ol where ol.r2_object_key = p_object_key
      union all
      select 1 from public.profiles pr where pr.avatar_object_key = p_object_key
      union all
      select 1 from public.subscription_applications sa
      where sa.screenshot_object_key = p_object_key
    )
  end;
$$;

comment on function public.r2_object_still_referenced(text) is
  'True when any materials/OSPE/pearl/one_liner/avatar/payment-proof row still references the R2 object key.';

-- ---------------------------------------------------------------------------
-- purge_content: enqueue one_liner R2 after hard-delete (same pattern as pearl)
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
      select year_id, left(title, 200), r2_object_key
        into v_year_id, v_name, v_r2
      from public.one_liners where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.one_liners where id = p_entity_id and deleted_at is not null;
      perform public.enqueue_r2_purge_if_unreferenced(v_r2, 'one_liner', p_entity_id);

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

-- ---------------------------------------------------------------------------
-- purge_expired_bin_items: enqueue one_liner R2 keys
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
    select id, r2_object_key from public.one_liners
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.one_liners where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'one_liner', r.id);
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
