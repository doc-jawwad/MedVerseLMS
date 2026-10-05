-- GATE: Academic / Notes permission fan-out optimization.
-- Preserve can_access_material_folder / can_view_material_folder semantics exactly.
-- Replace per-folder scalar RPC loops with set-based evaluation.
-- Does not change Content Bin, auth, leaderboard, Test, or MCQ workflows.

-- ---------------------------------------------------------------------------
-- 1. accessible_folder_ids — set-based (same predicate as can_access_material_folder)
-- ---------------------------------------------------------------------------
create or replace function public.accessible_folder_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      (select auth.uid()) as uid,
      public.account_allows_lms() as ok
  ),
  enrolled_years as (
    select e.year_id
    from public.enrollments e
    cross join me
    where me.uid is not null
      and e.student_id = me.uid
      and e.status = 'active'
  ),
  folder_grants as (
    select g.folder_id
    from public.access_grants g
    cross join me
    where me.uid is not null
      and g.student_id = me.uid
      and g.grant_type = 'materials_folder'
      and g.revoked_at is null
      and g.folder_id is not null
  ),
  folder_restrictions as (
    select r.folder_id
    from public.access_restrictions r
    cross join me
    where me.uid is not null
      and r.student_id = me.uid
      and r.resource_kind = 'materials_folder'
      and r.revoked_at is null
      and r.folder_id is not null
  )
  select f.id
  from public.material_folders f
  cross join me
  where me.ok
    and f.deleted_at is null
    -- can_view_material_folder (inlined, set joins)
    and (
      f.library_type = 'career_counseling_series'
      or f.year_id in (select year_id from enrolled_years)
      or f.id in (select folder_id from folder_grants)
    )
    -- can_access_material_folder content half
    and f.id not in (select folder_id from folder_restrictions)
    and (
      (
        f.library_type = 'mcq_bank'
        and f.subject_id is not null
        and public.has_practice_access(f.subject_id)
      )
      or f.id in (select folder_id from folder_grants)
      or public.resource_entitlement_allows(f.entitlement, f.required_plan_id)
    );
$$;

comment on function public.accessible_folder_ids() is
  'Set-based folder content access ids. Semantically identical to filtering material_folders with can_access_material_folder(id).';

revoke all on function public.accessible_folder_ids() from public;
grant execute on function public.accessible_folder_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. accessible_folder_ids_among — scoped set for Notes / library pages
-- ---------------------------------------------------------------------------
create or replace function public.accessible_folder_ids_among(p_folder_ids uuid[])
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select af.id
  from public.accessible_folder_ids() af
  where p_folder_ids is not null
    and af.id = any (p_folder_ids);
$$;

comment on function public.accessible_folder_ids_among(uuid[]) is
  'Subset of accessible_folder_ids for a caller-supplied folder id list (Notes/library pages).';

revoke all on function public.accessible_folder_ids_among(uuid[]) from public;
grant execute on function public.accessible_folder_ids_among(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. get_academic_tree — one accessible-id set, no per-folder RPC loops
-- ---------------------------------------------------------------------------
create or replace function public.get_academic_tree(p_surface text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year_id uuid;
  v_year_number int;
  v_year_name text;
  v_live boolean;
  v_subjects jsonb := '[]'::jsonb;
  v_subj record;
  v_cats jsonb;
  v_folders jsonb;
  v_prof jsonb;
  v_ps_subjects jsonb := '[]'::jsonb;
  v_ps_folders jsonb;
  v_days jsonb;
  v_accessible uuid[] := array[]::uuid[];
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_surface not in ('resources', 'library') then
    raise exception 'invalid_surface';
  end if;

  select e.year_id, y.year_number, y.name
  into v_year_id, v_year_number, v_year_name
  from public.enrollments e
  join public.years y on y.id = e.year_id
  where e.student_id = v_uid and e.status = 'active';

  if v_year_id is null then
    raise exception 'no_active_enrollment';
  end if;

  v_live := public.has_live_subscription();

  if v_year_number = 5 then
    v_year_name := 'Final Year MBBS';
  end if;

  -- One set-based access evaluation for the enrolled year (replaces per-folder RPC).
  -- Year-scoped folders with active enrollment are catalog-visible (can_view);
  -- locked flags use accessible_folder_ids content semantics.
  select coalesce(array_agg(af.id), array[]::uuid[])
  into v_accessible
  from public.accessible_folder_ids() af
  join public.material_folders f on f.id = af.id
  where f.year_id = v_year_id
    and f.deleted_at is null;

  -- Academic product subjects (Notes + Syllabus live; academic surface folders only)
  for v_subj in
    select s.id, s.name, s.sort_order, s.product_key, s.entitlement, s.required_plan_id
    from public.subjects s
    where s.year_id = v_year_id
      and s.product_key is not null
    order by s.sort_order, s.name
  loop
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'folder_id', f.id,
        'name', f.name,
        'locked', not (f.id = any (v_accessible)),
        'parent_id', f.parent_id,
        'library_type', f.library_type
      )
      order by f.sort_order, f.name
    ), '[]'::jsonb)
    into v_folders
    from public.material_folders f
    where f.year_id = v_year_id
      and f.subject_id = v_subj.id
      and f.deleted_at is null
      and coalesce(f.content_surface, 'academic') = 'academic'
      and f.prof_session_day_id is null;

    select jsonb_agg(cat order by ord) into v_cats
    from (
      select 1 as ord, jsonb_build_object(
        'library_type', 'mcq_bank', 'name', 'MCQ Bank',
        'locked', false, 'placeholder', false, 'folders', '[]'::jsonb
      ) as cat
      union all
      select 2, jsonb_build_object(
        'library_type', 'one_liner', 'name', 'One Liner',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'one_liner'
        ), '[]'::jsonb)
      )
      union all
      select 3, jsonb_build_object(
        'library_type', 'guidelines', 'name', 'Guidelines',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'guidelines'
        ), '[]'::jsonb)
      )
      union all
      select 4, jsonb_build_object(
        'library_type', 'books', 'name', 'Books',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'books'
        ), '[]'::jsonb)
      )
      union all
      select 5, jsonb_build_object(
        'library_type', 'lectures', 'name', 'Lectures',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'lectures'
        ), '[]'::jsonb)
      )
      union all
      select 6, jsonb_build_object(
        'library_type', 'notes', 'name', 'Notes',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'notes'
        ), '[]'::jsonb)
      )
      union all
      select 7, jsonb_build_object(
        'library_type', 'syllabus', 'name', 'Syllabus',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'syllabus'
        ), '[]'::jsonb)
      )
      union all
      select 8, jsonb_build_object(
        'library_type', 'ospe_material', 'name', 'OSPE Material',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'ospe_material'
        ), '[]'::jsonb)
      )
      union all
      select 9, jsonb_build_object(
        'library_type', 'ospe_lectures', 'name', 'OSPE Lectures',
        'locked', false, 'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x) from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'ospe_lectures'
        ), '[]'::jsonb)
      )
    ) cats;

    v_subjects := v_subjects || jsonb_build_array(
      jsonb_build_object(
        'subject_id', v_subj.id,
        'name', v_subj.name,
        'product_key', v_subj.product_key,
        'locked', false,
        'categories', coalesce(v_cats, '[]'::jsonb)
      )
    );
  end loop;

  if not v_live then
    v_prof := jsonb_build_object('locked', true, 'subjects', '[]'::jsonb);
  else
    for v_subj in
      select s.id, s.name, s.sort_order, s.product_key
      from public.subjects s
      where s.year_id = v_year_id
        and s.product_key is not null
      order by s.sort_order, s.name
    loop
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'folder_id', f.id,
          'name', f.name,
          'locked', not (f.id = any (v_accessible)),
          'parent_id', f.parent_id,
          'library_type', f.library_type
        )
        order by f.sort_order, f.name
      ), '[]'::jsonb)
      into v_ps_folders
      from public.material_folders f
      where f.year_id = v_year_id
        and f.subject_id = v_subj.id
        and f.deleted_at is null
        and f.content_surface = 'prof_session'
        and f.prof_session_day_id is null;

      select coalesce(jsonb_agg(
        jsonb_build_object(
          'day_id', d.id,
          'name', d.name,
          'sort_order', d.sort_order,
          'practice_count', (
            select count(*)::int from public.prof_session_day_practice_questions pq
            where pq.day_id = d.id
          ),
          'test_count', (
            select count(*)::int from public.tests t
            where t.prof_session_day_id = d.id
              and t.status is distinct from 'archived'
          ),
          'one_liner_count', (
            select count(*)::int from public.one_liners ol
            where ol.prof_session_day_id = d.id
              and ol.deleted_at is null
              and ol.status = 'published'
          ),
          'has_guidelines', exists (
            select 1 from public.material_folders mf
            where mf.prof_session_day_id = d.id
              and mf.day_slot_key = 'guidelines'
              and mf.deleted_at is null
          ),
          'has_los', exists (
            select 1 from public.material_folders mf
            where mf.prof_session_day_id = d.id
              and mf.day_slot_key = 'los'
              and mf.deleted_at is null
          ),
          'slots', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'slot_key', sl.slot_key,
                'name', case sl.slot_key
                  when 'guidelines' then 'Guidelines'
                  when 'los' then 'LoS'
                  when 'one_liners' then 'One-Liners'
                  when 'practice_mcqs' then 'Practice MCQs'
                  when 'test_mcq' then 'Test MCQs'
                end
              )
              order by case sl.slot_key
                when 'guidelines' then 1
                when 'los' then 2
                when 'practice_mcqs' then 3
                when 'test_mcq' then 4
                when 'one_liners' then 5
              end
            ), '[]'::jsonb)
            from public.prof_session_day_slots sl
            where sl.day_id = d.id
          )
        )
        order by d.sort_order, d.name
      ), '[]'::jsonb)
      into v_days
      from public.prof_session_days d
      where d.subject_id = v_subj.id
        and d.status = 'published'
        and d.deleted_at is null;

      v_ps_subjects := v_ps_subjects || jsonb_build_array(
        jsonb_build_object(
          'subject_id', v_subj.id,
          'name', v_subj.name,
          'product_key', v_subj.product_key,
          'folders', coalesce(v_ps_folders, '[]'::jsonb),
          'days', coalesce(v_days, '[]'::jsonb)
        )
      );
    end loop;

    v_prof := jsonb_build_object(
      'locked', false,
      'subjects', coalesce(v_ps_subjects, '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'surface', p_surface,
    'year_id', v_year_id,
    'year_number', v_year_number,
    'year_name', v_year_name,
    'subjects', v_subjects,
    'prof_session', v_prof
  );
end;
$$;

comment on function public.get_academic_tree(text) is
  'Product Blocks + categories (incl. live Notes/Syllabus/One Liner PDF folders) + Prof. Session. Folder lock flags from one set-based accessible_folder_ids evaluation. Soft-deleted excluded. Free: prof_session locked.';

revoke all on function public.get_academic_tree(text) from public;
grant execute on function public.get_academic_tree(text) to authenticated, service_role;
