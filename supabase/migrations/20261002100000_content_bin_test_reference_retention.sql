-- Content Bin ↔ test_questions retention rule (docs/database.md, docs/test-rules.md).
-- 1) validate_test / publish: refuse soft-deleted questions (prevention only).
-- 2) purge_expired_bin_items: expected question_referenced_by_test → retained_* not error_text.
-- 3) list_content_bin_page: surface retain_reason for UI.
-- Does NOT weaken purge_content / purge_content_batch question_referenced_by_test guard.
-- Does NOT auto-detach draft test_questions. Does NOT mutate published history.

-- ---------------------------------------------------------------------------
-- purge_log: distinguish expected retention from operational failures
-- ---------------------------------------------------------------------------
alter table public.purge_log
  add column if not exists retained_count int not null default 0,
  add column if not exists retained_text text;

comment on column public.purge_log.retained_count is
  'Expected skips this run (e.g. questions retained for test_questions). Not failures.';
comment on column public.purge_log.retained_text is
  'Human/ops detail for retained skips (question_referenced_by_test). Separate from error_text.';
comment on table public.purge_log is
  'Runs of purge_expired_bin_items. deleted_count purged; retained_* expected skips; error_text real failures. service_role / cron only.';

-- ---------------------------------------------------------------------------
-- validate_test: no soft-deleted questions on publish path
-- ---------------------------------------------------------------------------
create or replace function public.validate_test(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  v jsonb := '[]'::jsonb;
  n_questions int;
  n_distinct int;
  n_unapproved int;
  n_soft_deleted int;
  n_bad_content int;
  has_audience boolean;
  is_mock boolean;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  select * into t from public.tests where id = p_test_id;
  if not found then raise exception 'test not found'; end if;

  is_mock := (t.test_type = 'mock');

  select count(*), count(distinct question_id)
    into n_questions, n_distinct
  from public.test_questions
  where test_id = p_test_id;

  v := v || jsonb_build_object('check', 'question count >= ' || t.min_questions,
    'pass', n_questions >= t.min_questions and n_questions > 0,
    'detail', n_questions || ' questions');

  v := v || jsonb_build_object('check', 'no duplicate questions',
    'pass', n_questions = n_distinct,
    'detail', case when n_questions = n_distinct then 'ok'
                   else (n_questions - n_distinct) || ' duplicates' end);

  select count(*) into n_unapproved
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  where tq.test_id = p_test_id and q.status <> 'approved';
  v := v || jsonb_build_object('check', 'all questions approved',
    'pass', n_unapproved = 0, 'detail', n_unapproved || ' not approved');

  select count(*) into n_soft_deleted
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  where tq.test_id = p_test_id and q.deleted_at is not null;
  v := v || jsonb_build_object('check', 'no soft-deleted questions',
    'pass', n_soft_deleted = 0,
    'detail', n_soft_deleted || ' in Content Bin');

  select count(*) into n_bad_content
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  join public.question_versions qv on qv.id = q.current_version_id
  where tq.test_id = p_test_id
    and (
      jsonb_array_length(qv.options) not between 4 and 5
      or not exists (
        select 1 from jsonb_array_elements(qv.options) o
        where o ->> 'key' = trim(qv.correct_key::text)
      )
    );
  v := v || jsonb_build_object('check', 'options complete + valid correct keys',
    'pass', n_bad_content = 0, 'detail', n_bad_content || ' invalid');

  if is_mock then
    v := v || jsonb_build_object('check', 'valid schedule (optional for mock tests)',
      'pass', true,
      'detail', case
        when t.opens_at is null then 'no window set — mock runs year-round'
        else coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset')
      end);
  else
    v := v || jsonb_build_object('check', 'valid schedule',
      'pass', t.opens_at is not null and t.closes_at is not null
        and t.opens_at < t.closes_at and t.closes_at > now(),
      'detail', coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset'));
  end if;

  v := v || jsonb_build_object('check', 'duration > 0',
    'pass', t.duration_minutes > 0, 'detail', t.duration_minutes || ' minutes');

  if is_mock then
    v := v || jsonb_build_object('check', 'duration fits window (optional for mock tests)',
      'pass', true, 'detail', t.duration_minutes || ' minutes');
  else
    v := v || jsonb_build_object('check', 'duration fits the window',
      'pass', t.opens_at is not null and t.closes_at is not null
        and t.duration_minutes * interval '1 minute' <= (t.closes_at - t.opens_at),
      'detail', t.duration_minutes || ' minutes');
  end if;

  v := v || jsonb_build_object('check', 'valid marking scheme',
    'pass', t.marks_per_question > 0 and t.negative_mark >= 0,
    'detail', t.marks_per_question || ' per question, −' || t.negative_mark || ' per wrong');

  select exists (select 1 from public.test_audiences where test_id = p_test_id)
    or exists (select 1 from public.access_grants
      where test_id = p_test_id and grant_type = 'test' and revoked_at is null)
  into has_audience;
  v := v || jsonb_build_object('check', 'audience assigned (year or student grants)',
    'pass', has_audience,
    'detail', case when has_audience then 'ok' else 'nobody can see this test' end);

  return v;
end;
$$;

comment on function public.validate_test(uuid) is
  'Pre-publish checklist (docs/test-rules.md). Includes no soft-deleted questions (Content Bin).';

-- ---------------------------------------------------------------------------
-- list_content_bin_page: retain_reason for test-referenced questions
-- ---------------------------------------------------------------------------
drop function if exists public.list_content_bin_page(uuid, int, int);

create function public.list_content_bin_page(
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
  retain_reason text,
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
           mf.year_id, mf.deleted_at, mf.purge_after, mf.deleted_by, false as has_r2,
           null::text as retain_reason
    from public.material_folders mf
    where mf.deleted_at is not null
      and (
        (
          mf.library_type = 'career_counseling_series'
          and mf.year_id is null
          and public.has_permission('manage_materials')
        )
        or (
          mf.year_id is not null
          and (p_year_id is null or mf.year_id = p_year_id)
          and public.admin_can_access_year(mf.year_id)
        )
      )
    union all
    select 'material'::text, m.id, m.title, mf2.year_id, m.deleted_at, m.purge_after, m.deleted_by,
           (m.r2_object_key is not null), null::text
    from public.materials m
    join public.material_folders mf2 on mf2.id = m.folder_id
    where m.deleted_at is not null
      and (
        (
          mf2.library_type = 'career_counseling_series'
          and mf2.year_id is null
          and public.has_permission('manage_materials')
        )
        or (
          mf2.year_id is not null
          and (p_year_id is null or mf2.year_id = p_year_id)
          and public.admin_can_access_year(mf2.year_id)
        )
      )
    union all
    select 'pearl_point'::text, pp.id, left(pp.prompt, 200), pp.year_id,
           pp.deleted_at, pp.purge_after, pp.deleted_by, false, null::text
    from public.pearl_points pp
    where pp.deleted_at is not null
      and (p_year_id is null or pp.year_id = p_year_id)
      and public.admin_can_access_year(pp.year_id)
    union all
    select 'ospe_station'::text, os.id, os.title, os.year_id, os.deleted_at, os.purge_after, os.deleted_by,
           (os.r2_object_key is not null), null::text
    from public.ospe_stations os
    where os.deleted_at is not null
      and (p_year_id is null or os.year_id = p_year_id)
      and public.admin_can_access_year(os.year_id)
    union all
    select 'question'::text, q.id, left(coalesce(qv.stem, q.stem_normalized, 'Untitled'), 80),
           q.year_id, q.deleted_at, q.purge_after, q.deleted_by, false,
           case
             when exists (
               select 1 from public.test_questions tq where tq.question_id = q.id
             ) then 'retained_referenced_by_test'
             else null
           end
    from public.questions q
    left join public.question_versions qv on qv.id = q.current_version_id
    where q.deleted_at is not null
      and (p_year_id is null or q.year_id = p_year_id)
      and public.admin_can_access_year(q.year_id)
    union all
    select 'prof_session_day'::text, psd.id, psd.name, psd.year_id,
           psd.deleted_at, psd.purge_after, psd.deleted_by, false, null::text
    from public.prof_session_days psd
    where psd.deleted_at is not null
      and (p_year_id is null or psd.year_id = p_year_id)
      and public.admin_can_access_year(psd.year_id)
    union all
    select 'one_liner'::text, ol.id, left(ol.title, 80), ol.year_id,
           ol.deleted_at, ol.purge_after, ol.deleted_by, false, null::text
    from public.one_liners ol
    where ol.deleted_at is not null
      and (p_year_id is null or ol.year_id = p_year_id)
      and public.admin_can_access_year(ol.year_id)
    union all
    select 'mcq_bank_folder'::text, mbf.id, mbf.name, mbf.year_id,
           mbf.deleted_at, mbf.purge_after, mbf.deleted_by, false, null::text
    from public.mcq_bank_folders mbf
    where mbf.deleted_at is not null
      and (p_year_id is null or mbf.year_id = p_year_id)
      and public.admin_can_access_year(mbf.year_id)
    union all
    select 'mcq_bank_subfolder'::text, s.id, s.name, s.year_id,
           s.deleted_at, s.purge_after, s.deleted_by, false, null::text
    from public.mcq_bank_subfolders s
    where s.deleted_at is not null
      and (p_year_id is null or s.year_id = p_year_id)
      and public.admin_can_access_year(s.year_id)
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
    r.retain_reason,
    r.total_count
  from ranked r
  where r.rn > v_offset
    and r.rn <= v_offset + v_limit
  order by r.rn;
end;
$$;

comment on function public.list_content_bin_page(uuid, int, int) is
  'Paginated Content Bin. Cap limit 100. retain_reason=retained_referenced_by_test when a question still has test_questions.';

revoke execute on function public.list_content_bin_page(uuid, int, int) from public, anon;
grant execute on function public.list_content_bin_page(uuid, int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- purge_expired_bin_items: retained vs error for question_referenced_by_test
-- (full body mirrors 20261001050000 + retention accounting)
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
      -- Expected retention: any test_questions row (draft or published). Not a failure.
      if exists (
        select 1 from public.test_questions tq where tq.question_id = r.id
      ) then
        v_retained_count := v_retained_count + 1;
        v_retained := coalesce(v_retained || '; ', '')
          || format('question %s: question_referenced_by_test', r.id);
        continue;
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

  insert into public.purge_log (deleted_count, error_text, retained_count, retained_text)
  values (v_count, v_err, v_retained_count, v_retained);
end;
$$;

comment on function public.purge_expired_bin_items() is
  'Cron hard-delete where purge_after <= now(). Questions with any test_questions row are retained (retained_*), not error_text. Manual purge_content still raises question_referenced_by_test.';

comment on column public.questions.deleted_at is
  'Soft-delete timestamp. Hard purge only when purge_after elapsed AND no test_questions row; otherwise retained (not an integrity failure).';

comment on function public.purge_content(text, uuid) is
  'Hard-delete one Content Bin entity. Question path raises question_referenced_by_test if any test_questions row exists (unchanged).';
