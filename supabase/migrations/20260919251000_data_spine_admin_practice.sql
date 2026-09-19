-- Data Spine: admin_year_assignments + practice_progress + practice_sessions.
-- No flashcards table. Practice state independent of practice_answers.
-- Reset Done→Remaining preserves marked.

-- ---------------------------------------------------------------------------
-- admin_year_assignments
-- ---------------------------------------------------------------------------
create table public.admin_year_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  admin_id uuid not null references public.profiles (id) on delete cascade,
  year_id uuid not null references public.years (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admin_id, year_id)
);

create index admin_year_assignments_admin_idx
  on public.admin_year_assignments (admin_id);
create index admin_year_assignments_year_idx
  on public.admin_year_assignments (year_id);

create trigger admin_year_assignments_updated_at
  before update on public.admin_year_assignments
  for each row execute function public.set_updated_at();

comment on table public.admin_year_assignments is
  'Assigned-class scope for limited admins. Main Admin needs no rows.';

alter table public.admin_year_assignments enable row level security;

create policy admin_year_assignments_select on public.admin_year_assignments
  for select using (
    public.is_main_admin()
    or public.has_permission('manage_admins')
    or admin_id = (select auth.uid())
  );

-- Writes via RPC only
create or replace function public.protect_admin_year_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('medverse.admin_year_assignment_rpc', true) is distinct from '1' then
    raise exception 'admin_year_assignment_rpc_only';
  end if;
  return new;
end;
$$;

create trigger admin_year_assignments_rpc_only
  before insert or update or delete on public.admin_year_assignments
  for each row execute function public.protect_admin_year_assignment();

create or replace function public.admin_can_access_year(p_year_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    and (
      public.is_main_admin()
      or exists (
        select 1
        from public.admin_year_assignments a
        where a.admin_id = (select auth.uid())
          and a.year_id = p_year_id
      )
    );
$$;

revoke execute on function public.admin_can_access_year(uuid) from public, anon;
grant execute on function public.admin_can_access_year(uuid) to authenticated, service_role;

create or replace function public.list_admin_year_assignments(
  p_admin_id uuid default null
)
returns table (
  admin_id uuid,
  year_id uuid,
  year_number int,
  year_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  v_target := coalesce(p_admin_id, (select auth.uid()));

  if v_target is distinct from (select auth.uid())
     and not public.has_permission('manage_admins') then
    raise exception 'permission_denied';
  end if;

  return query
  select
    a.admin_id,
    a.year_id,
    y.year_number,
    case when y.year_number = 5 then 'Final Year MBBS' else y.name end
  from public.admin_year_assignments a
  join public.years y on y.id = a.year_id
  where a.admin_id = v_target
  order by y.year_number;
end;
$$;

revoke execute on function public.list_admin_year_assignments(uuid) from public, anon;
grant execute on function public.list_admin_year_assignments(uuid) to authenticated, service_role;

create or replace function public.set_admin_year_assignments(
  p_admin_id uuid,
  p_year_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_year_ids, '{}');
  v_id uuid;
begin
  perform public.require_permission('manage_admins');

  if not exists (
    select 1 from public.profiles
    where id = p_admin_id and role = 'admin'
  ) then
    raise exception 'admin_not_found';
  end if;

  foreach v_id in array v_ids loop
    if not exists (select 1 from public.years where id = v_id) then
      raise exception 'invalid_year';
    end if;
  end loop;

  perform set_config('medverse.admin_year_assignment_rpc', '1', true);

  delete from public.admin_year_assignments
  where admin_id = p_admin_id;

  insert into public.admin_year_assignments (admin_id, year_id)
  select p_admin_id, unnest(v_ids)
  on conflict (admin_id, year_id) do nothing;

  perform set_config('medverse.admin_year_assignment_rpc', '', true);

  perform public.log_audit(
    'admin_year_assignments_set',
    'admin',
    p_admin_id,
    jsonb_build_object('year_ids', to_jsonb(v_ids))
  );
exception
  when others then
    perform set_config('medverse.admin_year_assignment_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.set_admin_year_assignments(uuid, uuid[]) from public, anon;
grant execute on function public.set_admin_year_assignments(uuid, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- practice_progress (Done/Marked — independent of practice_answers)
-- ---------------------------------------------------------------------------
create table public.practice_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  item_kind text not null check (item_kind in ('question', 'pearl')),
  item_id uuid not null,
  state text not null default 'remaining'
    check (state in ('remaining', 'done')),
  marked boolean not null default false,
  subject_id uuid references public.subjects (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (student_id, item_kind, item_id)
);

create index practice_progress_student_subject_idx
  on public.practice_progress (student_id, subject_id);
create index practice_progress_student_state_idx
  on public.practice_progress (student_id, state);
create index practice_progress_student_marked_idx
  on public.practice_progress (student_id, marked)
  where marked = true;

create trigger practice_progress_updated_at
  before update on public.practice_progress
  for each row execute function public.set_updated_at();

comment on table public.practice_progress is
  'Practice Done/Marked cursor. Not test_attempts. Independent of practice_answers.';

alter table public.practice_progress enable row level security;

create policy practice_progress_select on public.practice_progress
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('view_students')
    or public.has_permission('view_analytics')
  );

create or replace function public.protect_practice_progress()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('medverse.practice_progress_rpc', true) is distinct from '1' then
    raise exception 'practice_progress_rpc_only';
  end if;
  return new;
end;
$$;

create trigger practice_progress_rpc_only
  before insert or update or delete on public.practice_progress
  for each row execute function public.protect_practice_progress();

-- ---------------------------------------------------------------------------
-- practice_sessions (optional; justified for practice report persistence)
-- ---------------------------------------------------------------------------
create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms int,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index practice_sessions_student_idx
  on public.practice_sessions (student_id, started_at desc);

comment on table public.practice_sessions is
  'Optional practice report summary. Forward timer is client-side; server stores end summary.';

alter table public.practice_sessions enable row level security;

create policy practice_sessions_select on public.practice_sessions
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('view_students')
    or public.has_permission('view_analytics')
  );

create or replace function public.protect_practice_session()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('medverse.practice_session_rpc', true) is distinct from '1' then
    raise exception 'practice_session_rpc_only';
  end if;
  return new;
end;
$$;

create trigger practice_sessions_rpc_only
  before insert or update or delete on public.practice_sessions
  for each row execute function public.protect_practice_session();

-- ---------------------------------------------------------------------------
-- Practice progress RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_practice_progress(p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_total int;
  v_done int;
  v_marked int;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not public.can_view_practice_subject(p_subject_id) then
    raise exception 'practice_subject_not_visible';
  end if;

  select count(*)::int into v_total
  from public.questions q
  where q.subject_id = p_subject_id and q.status = 'approved';

  select
    count(*) filter (where pp.state = 'done')::int,
    count(*) filter (where pp.marked)::int
  into v_done, v_marked
  from public.practice_progress pp
  where pp.student_id = v_uid
    and pp.subject_id = p_subject_id
    and pp.item_kind = 'question';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item_kind', pp.item_kind,
      'item_id', pp.item_id,
      'state', pp.state,
      'marked', pp.marked
    )
    order by pp.updated_at desc
  ), '[]'::jsonb)
  into v_items
  from public.practice_progress pp
  where pp.student_id = v_uid
    and pp.subject_id = p_subject_id;

  return jsonb_build_object(
    'subject_id', p_subject_id,
    'total', v_total,
    'done', coalesce(v_done, 0),
    'remaining', greatest(v_total - coalesce(v_done, 0), 0),
    'marked', coalesce(v_marked, 0),
    'percent_complete', case
      when v_total > 0 then round(100.0 * coalesce(v_done, 0) / v_total, 1)
      else 0
    end,
    'items', v_items
  );
end;
$$;

revoke execute on function public.get_practice_progress(uuid) from public, anon;
grant execute on function public.get_practice_progress(uuid) to authenticated, service_role;

create or replace function public.set_practice_item_state(
  p_item_kind text,
  p_item_id uuid,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_item_kind is distinct from 'question' and p_item_kind is distinct from 'pearl' then
    raise exception 'invalid_item_kind';
  end if;
  if p_state not in ('remaining', 'done') then
    raise exception 'invalid_state';
  end if;

  if p_item_kind = 'question' then
    select q.subject_id into v_subject
    from public.questions q
    where q.id = p_item_id and q.status = 'approved';
  else
    select pp.subject_id into v_subject
    from public.pearl_points pp
    where pp.id = p_item_id and pp.status = 'published';
  end if;

  if v_subject is null then
    raise exception 'item_not_found';
  end if;
  if not public.has_practice_access(v_subject) then
    raise exception 'practice_access_denied';
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  insert into public.practice_progress (
    student_id, item_kind, item_id, state, marked, subject_id
  ) values (
    v_uid, p_item_kind, p_item_id, p_state, false, v_subject
  )
  on conflict (student_id, item_kind, item_id) do update
  set state = excluded.state,
      subject_id = excluded.subject_id,
      updated_at = now();
  perform set_config('medverse.practice_progress_rpc', '', true);
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.set_practice_item_state(text, uuid, text) from public, anon;
grant execute on function public.set_practice_item_state(text, uuid, text) to authenticated, service_role;

create or replace function public.set_practice_item_marked(
  p_item_kind text,
  p_item_id uuid,
  p_marked boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_item_kind is distinct from 'question' and p_item_kind is distinct from 'pearl' then
    raise exception 'invalid_item_kind';
  end if;

  if p_item_kind = 'question' then
    select q.subject_id into v_subject
    from public.questions q
    where q.id = p_item_id and q.status = 'approved';
  else
    select pp.subject_id into v_subject
    from public.pearl_points pp
    where pp.id = p_item_id and pp.status = 'published';
  end if;

  if v_subject is null then
    raise exception 'item_not_found';
  end if;
  if not public.has_practice_access(v_subject) then
    raise exception 'practice_access_denied';
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  insert into public.practice_progress (
    student_id, item_kind, item_id, state, marked, subject_id
  ) values (
    v_uid, p_item_kind, p_item_id, 'remaining', coalesce(p_marked, false), v_subject
  )
  on conflict (student_id, item_kind, item_id) do update
  set marked = excluded.marked,
      subject_id = excluded.subject_id,
      updated_at = now();
  perform set_config('medverse.practice_progress_rpc', '', true);
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.set_practice_item_marked(text, uuid, boolean) from public, anon;
grant execute on function public.set_practice_item_marked(text, uuid, boolean) to authenticated, service_role;

create or replace function public.reset_practice_done_to_remaining(p_subject_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not public.can_view_practice_subject(p_subject_id) then
    raise exception 'practice_subject_not_visible';
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  update public.practice_progress
  set state = 'remaining',
      updated_at = now()
  where student_id = v_uid
    and subject_id = p_subject_id
    and state = 'done';
  -- marked preserved; practice_answers untouched
  perform set_config('medverse.practice_progress_rpc', '', true);
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.reset_practice_done_to_remaining(uuid) from public, anon;
grant execute on function public.reset_practice_done_to_remaining(uuid) to authenticated, service_role;

create or replace function public.start_practice_session(p_subject_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_subject_id is not null
     and not public.can_view_practice_subject(p_subject_id) then
    raise exception 'practice_subject_not_visible';
  end if;

  perform set_config('medverse.practice_session_rpc', '1', true);
  insert into public.practice_sessions (student_id, subject_id, started_at)
  values (v_uid, p_subject_id, now())
  returning id into v_id;
  perform set_config('medverse.practice_session_rpc', '', true);
  return v_id;
exception
  when others then
    perform set_config('medverse.practice_session_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.start_practice_session(uuid) from public, anon;
grant execute on function public.start_practice_session(uuid) to authenticated, service_role;

create or replace function public.end_practice_session(
  p_session_id uuid,
  p_duration_ms int default null,
  p_counts jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.practice_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row
  from public.practice_sessions
  where id = p_session_id;
  if not found or v_row.student_id is distinct from v_uid then
    raise exception 'session_not_found';
  end if;
  if v_row.ended_at is not null then
    return;
  end if;

  perform set_config('medverse.practice_session_rpc', '1', true);
  update public.practice_sessions
  set
    ended_at = now(),
    duration_ms = p_duration_ms,
    counts = coalesce(p_counts, counts)
  where id = p_session_id;
  perform set_config('medverse.practice_session_rpc', '', true);
exception
  when others then
    perform set_config('medverse.practice_session_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.end_practice_session(uuid, int, jsonb) from public, anon;
grant execute on function public.end_practice_session(uuid, int, jsonb) to authenticated, service_role;
