-- Data Spine: material_folders.parent_id, academic tree/search,
-- leaderboard projection, profile update + avatar authorize.
-- No flashcards table. No protected payloads on locked tree nodes.
-- rank_test unchanged — projection wraps submitted ranks only.

-- ---------------------------------------------------------------------------
-- material_folders.parent_id + library_type expansions
-- ---------------------------------------------------------------------------
alter table public.material_folders
  add column if not exists parent_id uuid references public.material_folders (id) on delete cascade;

create index if not exists material_folders_parent_idx
  on public.material_folders (parent_id);

alter table public.material_folders
  drop constraint if exists material_folders_library_type_check;

alter table public.material_folders
  add constraint material_folders_library_type_check
  check (library_type in (
    'guidelines',
    'ospe_material',
    'ospe_lectures',
    'books',
    'notes',
    'lectures',
    'past_papers',
    'flashcards'
  ));

comment on column public.material_folders.parent_id is
  'Optional folder nesting. Same year/subject; cycles forbidden via trigger.';
comment on column public.material_folders.library_type is
  'Student library category. flashcards is placeholder-only (empty content OK). Notes stays distinct.';

create or replace function public.protect_material_folder_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_walk uuid;
  v_guard int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'folder_parent_cycle';
  end if;

  -- Parent must share year (and subject if both set).
  if not exists (
    select 1 from public.material_folders p
    where p.id = new.parent_id
      and p.year_id = new.year_id
      and (new.subject_id is null or p.subject_id is null or p.subject_id = new.subject_id)
  ) then
    raise exception 'folder_parent_mismatch';
  end if;

  v_walk := new.parent_id;
  while v_walk is not null loop
    v_guard := v_guard + 1;
    if v_guard > 50 then
      raise exception 'folder_parent_cycle';
    end if;
    if v_walk = new.id then
      raise exception 'folder_parent_cycle';
    end if;
    select parent_id into v_walk
    from public.material_folders
    where id = v_walk;
  end loop;

  return new;
end;
$$;

drop trigger if exists material_folders_protect_parent on public.material_folders;
create trigger material_folders_protect_parent
  before insert or update of parent_id, year_id, subject_id on public.material_folders
  for each row execute function public.protect_material_folder_parent();

-- ---------------------------------------------------------------------------
-- get_academic_tree — metadata + lock flags only (no Drive/stems/keys)
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
  v_locked boolean;
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

  -- Library surface requires live subscription; still return tree with locks
  -- rather than hard-fail so UI can show SectionLock separately. Nodes locked.
  v_live := public.has_live_subscription();

  if v_year_number = 5 then
    v_year_name := 'Final Year MBBS';
  end if;

  for v_subj in
    select s.id, s.name, s.sort_order, s.entitlement, s.required_plan_id
    from public.subjects s
    where s.year_id = v_year_id
    order by s.sort_order, s.name
  loop
    -- Subject-level lock: library without live sub → locked; resources →
    -- navigable (locked=false for chrome). Item open still RPC-gated.
    v_locked := (p_surface = 'library' and not v_live);

    -- Folders for this subject (catalog visibility only; no material bodies).
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'folder_id', f.id,
        'name', f.name,
        'locked', case
          when p_surface = 'library' and not v_live then true
          when p_surface = 'resources' then not public.can_access_material_folder(f.id)
          else not public.can_access_material_folder(f.id)
        end,
        'parent_id', f.parent_id,
        'library_type', f.library_type
      )
      order by f.sort_order, f.name
    ), '[]'::jsonb)
    into v_folders
    from public.material_folders f
    where f.year_id = v_year_id
      and f.subject_id = v_subj.id
      and public.can_view_material_folder(f.id);

    -- Build category buckets from product library_types (+ placeholder flashcards).
    select jsonb_agg(cat order by ord) into v_cats
    from (
      select
        1 as ord,
        jsonb_build_object(
          'library_type', 'test',
          'name', 'Test',
          'locked', v_locked,
          'placeholder', false,
          'folders', '[]'::jsonb
        ) as cat
      union all
      select 2, jsonb_build_object(
        'library_type', 'ospe',
        'name', 'OSPE',
        'locked', v_locked,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' in ('ospe_material', 'ospe_lectures')
        ), '[]'::jsonb)
      )
      union all
      select 3, jsonb_build_object(
        'library_type', 'lectures',
        'name', 'Lectures',
        'locked', v_locked,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'lectures'
        ), '[]'::jsonb)
      )
      union all
      select 4, jsonb_build_object(
        'library_type', 'books',
        'name', 'Books',
        'locked', v_locked,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'books'
        ), '[]'::jsonb)
      )
      union all
      select 5, jsonb_build_object(
        'library_type', 'past_papers',
        'name', 'Past Papers',
        'locked', v_locked,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'past_papers'
        ), '[]'::jsonb)
      )
      union all
      select 6, jsonb_build_object(
        'library_type', 'notes',
        'name', 'Notes',
        'locked', v_locked,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'notes'
        ), '[]'::jsonb)
      )
      union all
      select 7, jsonb_build_object(
        'library_type', 'flashcards',
        'name', 'Flashcards',
        'locked', false,
        'placeholder', true,
        'folders', '[]'::jsonb
      )
      union all
      select 8, jsonb_build_object(
        'library_type', 'guidelines',
        'name', 'Guidelines',
        'locked', v_locked,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'guidelines'
        ), '[]'::jsonb)
      )
    ) cats;

    v_subjects := v_subjects || jsonb_build_array(
      jsonb_build_object(
        'subject_id', v_subj.id,
        'name', v_subj.name,
        'locked', v_locked,
        'categories', coalesce(v_cats, '[]'::jsonb)
      )
    );
  end loop;

  return jsonb_build_object(
    'surface', p_surface,
    'year_id', v_year_id,
    'year_number', v_year_number,
    'year_name', v_year_name,
    'subjects', v_subjects
  );
end;
$$;

revoke execute on function public.get_academic_tree(text) from public, anon;
grant execute on function public.get_academic_tree(text) to authenticated, service_role;

comment on function public.get_academic_tree(text) is
  'Class→subject→category→folder metadata with lock flags. No Drive URLs, stems, or correct_key.';

-- ---------------------------------------------------------------------------
-- search_academic_tree — tree names only
-- ---------------------------------------------------------------------------
create or replace function public.search_academic_tree(
  p_query text,
  p_limit int default 20
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
  v_q text;
  v_limit int;
  v_hits jsonb := '[]'::jsonb;
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

  select e.year_id,
    case when y.year_number = 5 then 'Final Year MBBS' else y.name end
  into v_year_id, v_year_name
  from public.enrollments e
  join public.years y on y.id = e.year_id
  where e.student_id = v_uid and e.status = 'active';

  if v_year_id is null then
    raise exception 'no_active_enrollment';
  end if;

  if lower(v_year_name) like '%' || v_q || '%' then
    v_hits := v_hits || jsonb_build_array(jsonb_build_object(
      'kind', 'class',
      'id', v_year_id,
      'name', v_year_name,
      'path_labels', jsonb_build_array(v_year_name),
      'locked', false
    ));
  end if;

  select coalesce(v_hits || jsonb_agg(
    jsonb_build_object(
      'kind', 'block',
      'id', s.id,
      'name', s.name,
      'path_labels', jsonb_build_array(v_year_name, s.name),
      'locked', false
    )
  ), v_hits)
  into v_hits
  from (
    select s.id, s.name
    from public.subjects s
    where s.year_id = v_year_id
      and lower(s.name) like '%' || v_q || '%'
    order by s.sort_order, s.name
    limit v_limit
  ) s;

  select coalesce(v_hits || jsonb_agg(
    jsonb_build_object(
      'kind', 'folder',
      'id', f.id,
      'name', f.name,
      'path_labels', jsonb_build_array(v_year_name, coalesce(subj.name, ''), f.name),
      'locked', not public.can_access_material_folder(f.id)
    )
  ), v_hits)
  into v_hits
  from (
    select f.id, f.name, f.subject_id
    from public.material_folders f
    where f.year_id = v_year_id
      and public.can_view_material_folder(f.id)
      and lower(f.name) like '%' || v_q || '%'
    order by f.sort_order, f.name
    limit v_limit
  ) f
  left join public.subjects subj on subj.id = f.subject_id;

  -- Cap total hits
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

revoke execute on function public.search_academic_tree(text, int) from public, anon;
grant execute on function public.search_academic_tree(text, int) to authenticated, service_role;

comment on function public.search_academic_tree(text, int) is
  'Name search over class/subject/folder only. No stem/PDF/video FTS.';

-- ---------------------------------------------------------------------------
-- test_leaderboard_projection — wraps rank_test results; no second engine
-- ---------------------------------------------------------------------------
create or replace function public.test_leaderboard_projection(
  p_test_id uuid,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_allowed boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));

  -- View gate: entitled OR admin analytics/students OR own submitted attempt.
  -- OWNER DECISION on classmate board view remains deferred for broader cases;
  -- this projection is the privacy-safe field set for Top 3 / Top 20 consumers.
  v_allowed :=
    public.can_access_test(p_test_id)
    or public.has_permission('view_analytics')
    or public.has_permission('view_students')
    or public.has_permission('publish_tests')
    or exists (
      select 1 from public.test_attempts a
      where a.test_id = p_test_id
        and a.student_id = (select auth.uid())
        and a.state = 'submitted'
    );

  if not v_allowed then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'rank', a.rank,
        'student_id', a.student_id,
        'full_name', p.full_name,
        'college_name', p.college_name,
        'avatar_object_key', p.avatar_object_key,
        'score', a.score
      )
      order by a.rank asc nulls last
    )
    from (
      select a.rank, a.student_id, a.score
      from public.test_attempts a
      where a.test_id = p_test_id
        and a.state = 'submitted'
        and a.rank is not null
      order by a.rank asc
      limit v_limit
    ) a
    join public.profiles p on p.id = a.student_id
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.test_leaderboard_projection(uuid, int) from public, anon;
grant execute on function public.test_leaderboard_projection(uuid, int) to authenticated, service_role;

comment on function public.test_leaderboard_projection(uuid, int) is
  'Top N projection: rank, student_id, full_name, college_name, avatar_object_key, score. Uses rank_test ranks only.';

-- ---------------------------------------------------------------------------
-- Profile update + avatar allocate / authorize
-- ---------------------------------------------------------------------------
create or replace function public.update_own_profile(
  p_full_name text,
  p_college_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_college text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  v_name := nullif(btrim(coalesce(p_full_name, '')), '');
  if v_name is null then
    raise exception 'invalid_full_name';
  end if;
  v_college := nullif(btrim(coalesce(p_college_name, '')), '');

  update public.profiles
  set
    full_name = v_name,
    college_name = v_college,
    updated_at = now()
  where id = v_uid;
end;
$$;

revoke execute on function public.update_own_profile(text, text) from public, anon;
grant execute on function public.update_own_profile(text, text) to authenticated, service_role;

create or replace function public.allocate_avatar_object_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  v_key := format(
    'study-content/avatars/%s/%s',
    v_uid,
    replace(gen_random_uuid()::text, '-', '')
  );

  update public.profiles
  set avatar_object_key = v_key,
      updated_at = now()
  where id = v_uid;

  return v_key;
end;
$$;

revoke execute on function public.allocate_avatar_object_key() from public, anon;
grant execute on function public.allocate_avatar_object_key() to authenticated, service_role;

create or replace function public.authorize_avatar_object(p_student_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid;
  v_key text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_target := coalesce(p_student_id, v_uid);

  -- Own avatar, or admin with student/analytics view, or board consumer of own class peer
  -- via leaderboard projection (key only returned if already entitled to see board).
  if v_target is distinct from v_uid
     and not public.has_permission('view_students')
     and not public.has_permission('view_analytics')
     and not public.has_permission('manage_students') then
    raise exception 'avatar_forbidden';
  end if;

  select avatar_object_key into v_key
  from public.profiles
  where id = v_target;

  if v_key is null or v_key !~ '^study-content/avatars/' then
    raise exception 'avatar_not_found';
  end if;

  return v_key;
end;
$$;

revoke execute on function public.authorize_avatar_object(uuid) from public, anon;
grant execute on function public.authorize_avatar_object(uuid) to authenticated, service_role;

comment on function public.allocate_avatar_object_key() is
  'Allocates private study-content/avatars/{uid}/{uuid} key and stores on profile.';
comment on function public.authorize_avatar_object(uuid) is
  'Returns avatar object key for signing. Own or permissioned admin only.';
