-- Search: align category names with product chrome (One Liner), return
-- only content-accessible folders, fix path_labels/product_key for hrefs,
-- and accept p_surface so free (resources) never exposes Prof. Session days.
-- Tree names only — never materials, stems, PDFs, or question items.
-- Semantics: free → accessible free/grant folders + class chrome; paid →
-- accessible class folders + published Prof. Session days when live.

drop function if exists public.search_academic_tree(text, int);

create function public.search_academic_tree(
  p_query text,
  p_limit int default 20,
  p_surface text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year_id uuid;
  v_year_name text;
  v_live boolean;
  v_surface text;
  v_include_prof boolean;
  v_q text;
  v_limit int;
  v_hits jsonb := '[]'::jsonb;
  v_accessible uuid[] := array[]::uuid[];
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  v_q := lower(btrim(coalesce(p_query, '')));
  if v_q = '' then
    return '[]'::jsonb;
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_live := public.has_live_subscription();

  v_surface := lower(btrim(coalesce(p_surface, '')));
  if v_surface = '' then
    v_surface := case when v_live then 'library' else 'resources' end;
  elsif v_surface not in ('resources', 'library') then
    raise exception 'invalid_surface';
  end if;

  -- Prof. Session tree is subscription-locked (architecture §2c).
  v_include_prof := v_live and v_surface = 'library';

  select e.year_id,
    case when y.year_number = 5 then 'Final Year MBBS' else y.name end
  into v_year_id, v_year_name
  from public.enrollments e
  join public.years y on y.id = e.year_id
  where e.student_id = v_uid and e.status = 'active';

  if v_year_id is null then
    raise exception 'no_active_enrollment';
  end if;

  select coalesce(array_agg(af.id), array[]::uuid[])
  into v_accessible
  from public.accessible_folder_ids() af
  join public.material_folders f on f.id = af.id
  where f.year_id = v_year_id
    and f.deleted_at is null;

  if lower(v_year_name) like '%' || v_q || '%' then
    v_hits := v_hits || jsonb_build_array(jsonb_build_object(
      'kind', 'class',
      'id', v_year_id,
      'name', v_year_name,
      'path_labels', jsonb_build_array(v_year_name),
      'locked', false
    ));
  end if;

  -- Product blocks (enrolled class only)
  select coalesce(v_hits || jsonb_agg(
    jsonb_build_object(
      'kind', 'block',
      'id', s.id,
      'name', s.name,
      'product_key', s.product_key,
      'path_labels', jsonb_build_array(v_year_name, s.name),
      'locked', false
    )
  ), v_hits)
  into v_hits
  from (
    select s.id, s.name, s.product_key
    from public.subjects s
    where s.year_id = v_year_id
      and s.product_key is not null
      and lower(s.name) like '%' || v_q || '%'
    order by s.sort_order, s.name
    limit v_limit
  ) s;

  -- Academic Block categories — one hit per product block (href needs product_key)
  select coalesce(v_hits || jsonb_agg(hit order by hit_ord), v_hits)
  into v_hits
  from (
    select
      jsonb_build_object(
        'kind', 'category',
        'id', s.id::text || ':' || c.library_type,
        'name', c.name,
        'product_key', s.product_key,
        'path_labels', jsonb_build_array(v_year_name, s.name, c.name),
        'locked', false
      ) as hit,
      row_number() over (order by s.sort_order, s.name, c.ord) as hit_ord
    from public.subjects s
    cross join (
      values
        (1, 'mcq_bank', 'MCQ Bank'),
        (2, 'one_liner', 'One Liner'),
        (3, 'guidelines', 'Guidelines'),
        (4, 'books', 'Books'),
        (5, 'lectures', 'Lectures'),
        (6, 'notes', 'Notes'),
        (7, 'syllabus', 'Syllabus'),
        (8, 'ospe_material', 'OSPE Material'),
        (9, 'ospe_lectures', 'OSPE Lectures')
    ) as c(ord, library_type, name)
    where s.year_id = v_year_id
      and s.product_key is not null
      and lower(c.name) like '%' || v_q || '%'
    order by s.sort_order, s.name, c.ord
    limit v_limit
  ) cats;

  -- Folders / subfolders: content-accessible only (free entitlement/grant or paid access).
  -- Soft-deleted and non-enrolled-year folders excluded. No material/item payloads.
  select coalesce(v_hits || jsonb_agg(
    jsonb_build_object(
      'kind', 'folder',
      'id', f.id,
      'name', f.name,
      'product_key', f.product_key,
      'path_labels', f.path_labels,
      'locked', false
    )
  ), v_hits)
  into v_hits
  from (
    select
      f.id,
      f.name,
      s.product_key,
      case
        when coalesce(f.content_surface, 'academic') = 'prof_session' then
          jsonb_build_array(
            v_year_name,
            'Prof. Session',
            coalesce(s.name, ''),
            case f.library_type
              when 'syllabus' then 'Syllabus'
              when 'schedule' then 'Schedule'
              when 'books' then 'Books'
              when 'notes' then 'Notes'
              when 'lectures' then 'Lectures'
              when 'ospe_past' then 'Past OSPE'
              when 'ospe_material' then 'OSPE Material'
              when 'ospe_lectures' then 'OSPE Lectures'
              when 'mcq_bank' then 'MCQ Bank'
              when 'one_liner' then 'One Liner'
              when 'guidelines' then 'Guidelines'
              else coalesce(f.library_type, 'Folder')
            end,
            f.name
          )
        else
          jsonb_build_array(
            v_year_name,
            coalesce(s.name, ''),
            case f.library_type
              when 'mcq_bank' then 'MCQ Bank'
              when 'one_liner' then 'One Liner'
              when 'guidelines' then 'Guidelines'
              when 'books' then 'Books'
              when 'lectures' then 'Lectures'
              when 'notes' then 'Notes'
              when 'syllabus' then 'Syllabus'
              when 'ospe_material' then 'OSPE Material'
              when 'ospe_lectures' then 'OSPE Lectures'
              else coalesce(f.library_type, 'Folder')
            end,
            f.name
          )
      end as path_labels
    from public.material_folders f
    left join public.subjects s on s.id = f.subject_id
    where f.year_id = v_year_id
      and f.deleted_at is null
      and f.prof_session_day_id is null
      and f.id = any (v_accessible)
      and lower(f.name) like '%' || v_q || '%'
      and (
        coalesce(f.content_surface, 'academic') = 'academic'
        or (v_include_prof and f.content_surface = 'prof_session')
      )
    order by f.sort_order, f.name
    limit v_limit
  ) f;

  if v_include_prof then
    if position(v_q in lower('prof. session')) > 0 then
      v_hits := v_hits || jsonb_build_array(jsonb_build_object(
        'kind', 'prof_session',
        'id', v_year_id::text || ':prof-session',
        'name', 'Prof. Session',
        'path_labels', jsonb_build_array(v_year_name, 'Prof. Session'),
        'locked', false
      ));
    end if;

    -- Prof. Session subject chrome categories (subscribed library only)
    select coalesce(v_hits || jsonb_agg(hit order by hit_ord), v_hits)
    into v_hits
    from (
      select
        jsonb_build_object(
          'kind', 'category',
          'id', 'ps:' || s.id::text || ':' || c.library_type,
          'name', c.name,
          'product_key', s.product_key,
          'path_labels', jsonb_build_array(
            v_year_name, 'Prof. Session', s.name, c.name
          ),
          'locked', false
        ) as hit,
        row_number() over (order by s.sort_order, s.name, c.ord) as hit_ord
      from public.subjects s
      cross join (
        values
          (1, 'syllabus', 'Syllabus'),
          (2, 'schedule', 'Schedule'),
          (3, 'books', 'Books'),
          (4, 'notes', 'Notes'),
          (5, 'lectures', 'Lectures'),
          (6, 'ospe_past', 'Past OSPE'),
          (7, 'ospe_material', 'OSPE Material'),
          (8, 'ospe_lectures', 'OSPE Lectures'),
          (9, 'mcq_bank', 'MCQ Bank')
      ) as c(ord, library_type, name)
      where s.year_id = v_year_id
        and s.product_key is not null
        and lower(c.name) like '%' || v_q || '%'
      order by s.sort_order, s.name, c.ord
      limit v_limit
    ) ps_cats;

    -- Published days for enrolled class (container names only — not slot items)
    select coalesce(v_hits || jsonb_agg(
      jsonb_build_object(
        'kind', 'prof_session_day',
        'id', d.id,
        'name', d.name,
        'product_key', d.product_key,
        'path_labels', jsonb_build_array(
          v_year_name, 'Prof. Session', d.subject_name, 'MCQ Bank', d.name
        ),
        'locked', false
      )
    ), v_hits)
    into v_hits
    from (
      select d.id, d.name, s.name as subject_name, s.product_key
      from public.prof_session_days d
      join public.subjects s on s.id = d.subject_id
      where d.year_id = v_year_id
        and d.subject_id is not null
        and d.status = 'published'
        and d.deleted_at is null
        and lower(d.name) like '%' || v_q || '%'
      order by d.sort_order, d.name
      limit v_limit
    ) d;
  end if;

  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb)
    from (
      select x
      from jsonb_array_elements(v_hits) x
      limit v_limit
    ) t
  );
end;
$$;

revoke execute on function public.search_academic_tree(text, int, text) from public, anon;
grant execute on function public.search_academic_tree(text, int, text) to authenticated, service_role;

comment on function public.search_academic_tree(text, int, text) is
  'Tree-name search (class/block/category/folder/day). Folders only when content-accessible. Free/resources: no Prof. Session. Paid/library + live: include published days. Never searches stems, PDFs, or items.';
