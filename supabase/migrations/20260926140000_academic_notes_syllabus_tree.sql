-- Academic subject chrome: Notes + Syllabus as live material categories.
-- Reuses existing material_folders / materials PDF path (no new storage).
-- Prof. Session surface unchanged (content_surface = 'prof_session').

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
        'locked', not public.can_access_material_folder(f.id),
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
      and f.prof_session_day_id is null
      and public.can_view_material_folder(f.id);

    select jsonb_agg(cat order by ord) into v_cats
    from (
      select 1 as ord, jsonb_build_object(
        'library_type', 'mcq_bank', 'name', 'MCQ Bank',
        'locked', false, 'placeholder', false, 'folders', '[]'::jsonb
      ) as cat
      union all
      select 2, jsonb_build_object(
        'library_type', 'pearl_points', 'name', 'Pearl Points',
        'locked', false, 'placeholder', false, 'folders', '[]'::jsonb
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
          'locked', not public.can_access_material_folder(f.id),
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
        and f.prof_session_day_id is null
        and public.can_view_material_folder(f.id);

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
  'Product Blocks + categories (incl. live Notes/Syllabus) + Prof. Session subjects with day-scoped MCQ Bank. Soft-deleted excluded. Free: prof_session locked.';

revoke all on function public.get_academic_tree(text) from public;
grant execute on function public.get_academic_tree(text) to authenticated;
