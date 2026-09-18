-- Account status + class enrollment as LMS-entry vs year assignment
-- (docs/permissions.md, docs/database.md, docs/exam-state-machine.md).
-- Does NOT add subscriptions, entitlements, admin_permissions, or year-change requests.

-- ---------------------------------------------------------------------------
-- profiles.account_status / is_main_admin
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists account_status text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'restricted', 'suspended', 'deactivated', 'revoked'));

alter table public.profiles
  add column if not exists is_main_admin boolean not null default false;

create index if not exists profiles_account_status_idx
  on public.profiles (account_status)
  where account_status <> 'active';

-- Existing admins become Main Admin so production admins are not locked out
-- of the later permission model (docs/permissions.md).
update public.profiles
set is_main_admin = true
where role = 'admin' and is_main_admin is distinct from true;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.account_allows_lms()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and account_status = 'active'
  );
$$;

create or replace function public.is_main_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and is_main_admin
  );
$$;

create or replace function public.is_active_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      public.account_allows_lms()
      and exists (
        select 1 from public.profiles
        where id = (select auth.uid())
          and active_session_id is not distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid
      )
    )
    or public.owns_live_attempt_session();
$$;

create or replace function public.has_active_enrollment(p_year_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.enrollments
      where student_id = (select auth.uid())
        and status = 'active'
        and year_id = p_year_id
    );
$$;

create or replace function public.can_access_test(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.tests t
      where t.id = p_test_id
        and t.status in ('published', 'closed')
        and (
          exists (
            select 1 from public.test_audiences a
            join public.enrollments e
              on e.year_id = a.year_id
             and e.student_id = (select auth.uid())
             and e.status = 'active'
            where a.test_id = t.id
          )
          or exists (
            select 1 from public.access_grants g
            where g.student_id = (select auth.uid())
              and g.grant_type = 'test'
              and g.test_id = t.id
              and g.revoked_at is null
          )
        )
    );
$$;

create or replace function public.has_practice_access(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1
      from public.subjects s
      join public.enrollments e
        on e.year_id = s.year_id
       and e.student_id = (select auth.uid())
       and e.status = 'active'
      join public.access_grants g
        on g.student_id = (select auth.uid())
       and g.grant_type = 'practice_subject'
       and g.subject_id = s.id
       and g.revoked_at is null
      where s.id = p_subject_id
    );
$$;

create or replace function public.register_session()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.account_allows_lms() then
    raise exception 'account_blocked';
  end if;
  update public.profiles
  set active_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid,
      last_login_at = now()
  where id = (select auth.uid());
end;
$$;

create or replace function public.practice_subjects()
returns table (
  subject_id uuid,
  subject_name text,
  approved_questions bigint,
  granted boolean,
  answered bigint,
  correct bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    (select count(*) from public.questions q
      where q.subject_id = s.id and q.status = 'approved') as approved_questions,
    public.has_practice_access(s.id) as granted,
    (select count(*) from public.practice_answers pa
      where pa.student_id = (select auth.uid()) and pa.subject_id = s.id) as answered,
    (select count(*) from public.practice_answers pa
      where pa.student_id = (select auth.uid()) and pa.subject_id = s.id and pa.is_correct) as correct
  from public.subjects s
  join public.enrollments e
    on e.year_id = s.year_id
   and e.student_id = (select auth.uid())
   and e.status = 'active'
  where public.account_allows_lms()
  order by s.sort_order, s.name;
$$;

-- ---------------------------------------------------------------------------
-- Profile column protection (students cannot change gated fields;
-- account_status updates from the app go through set_account_status).
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_gated_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_main_admin is distinct from old.is_main_admin then
    if (select auth.uid()) is not null and not public.is_admin() then
      raise exception 'is_main_admin changes require admin';
    end if;
    if old.is_main_admin and not new.is_main_admin
       and not exists (
         select 1 from public.profiles
         where is_main_admin and id <> old.id
       ) then
      raise exception 'cannot demote the last Main Admin';
    end if;
  end if;

  if new.account_status is distinct from old.account_status then
    if (select auth.uid()) is not null
       and current_setting('medverse.set_account_status', true) is distinct from '1' then
      raise exception 'account_status changes require set_account_status()';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_gated_columns on public.profiles;
create trigger profiles_protect_gated_columns
  before update on public.profiles
  for each row execute function public.protect_profile_gated_columns();

create or replace function public.protect_enrollment_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'update'
     and (select auth.uid()) is not null
     and not public.is_admin()
     and (
       new.year_id is distinct from old.year_id
       or new.student_id is distinct from old.student_id
       or new.status is distinct from old.status
     ) then
    raise exception 'students cannot change class assignment';
  end if;
  return new;
end;
$$;

drop trigger if exists enrollments_protect_assignment on public.enrollments;
create trigger enrollments_protect_assignment
  before update on public.enrollments
  for each row execute function public.protect_enrollment_assignment();

-- ---------------------------------------------------------------------------
-- Provisioning: active class enrollment (not pending LMS approval)
-- ---------------------------------------------------------------------------
create or replace function public.ensure_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (select auth.uid());
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_meta jsonb;
  v_email text;
  v_name text;
  v_year uuid;
begin
  if v_id is null then
    raise exception 'not authenticated';
  end if;

  v_meta := coalesce(v_claims -> 'user_metadata', '{}'::jsonb);
  if jsonb_typeof(v_meta) <> 'object' then
    v_meta := '{}'::jsonb;
  end if;

  v_email := coalesce(v_claims ->> 'email', '');
  v_name := coalesce(v_meta ->> 'full_name', '');

  insert into public.profiles (id, email, full_name)
  values (v_id, v_email, v_name)
  on conflict (id) do update
    set email = case when excluded.email <> '' then excluded.email else public.profiles.email end,
        full_name = case
          when excluded.full_name <> '' then excluded.full_name
          else public.profiles.full_name
        end;
  -- role, account_status, is_main_admin are never written here.

  begin
    v_year := nullif(v_meta ->> 'year_id', '')::uuid;
  exception when invalid_text_representation then
    v_year := null;
  end;

  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    select v_id, v_year, 'active'
    where not exists (
      select 1 from public.enrollments
      where student_id = v_id and status = 'active'
    );
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  begin
    v_year := nullif(new.raw_user_meta_data ->> 'year_id', '')::uuid;
  exception when invalid_text_representation then
    v_year := null;
  end;

  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    select new.id, v_year, 'active'
    where not exists (
      select 1 from public.enrollments
      where student_id = new.id and status = 'active'
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Data: backfill pending → active. Do NOT map enrollment suspended/revoked
-- onto account_status (pending owner decision).
-- ---------------------------------------------------------------------------
update public.enrollments
set status = 'active'
where status = 'pending';

alter table public.enrollments
  alter column status set default 'active';

drop index if exists public.enrollments_one_live;
create unique index enrollments_one_live
  on public.enrollments (student_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- start_attempt: new attempts require an active account; resume of an
-- in_progress attempt may continue after leave_in_progress (Layer 2).
-- ---------------------------------------------------------------------------
create or replace function public.start_attempt(p_test_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  a public.test_attempts%rowtype;
  v_aid uuid;
  v_order uuid[];
  v_opt_orders jsonb;
  v_questions jsonb;
  v_answers jsonb;
  v_resuming boolean;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;

  v_resuming := exists (
    select 1 from public.test_attempts
    where test_id = p_test_id
      and student_id = (select auth.uid())
      and state = 'in_progress'
  );

  -- New attempts require an active account even if Layer 1 was already kicked.
  -- Resume of leave_in_progress skips this and uses is_active_session() exemption.
  if not v_resuming and not public.account_allows_lms() then
    raise exception 'account_blocked';
  end if;
  if not public.is_active_session() then
    raise exception 'session_superseded';
  end if;
  if not v_resuming and not public.can_access_test(p_test_id) then
    raise exception 'test_access_denied';
  end if;

  select * into t from public.tests where id = p_test_id;
  if t.status <> 'published' or now() < t.opens_at or now() >= t.closes_at then
    if exists (select 1 from public.test_attempts
      where test_id = p_test_id and student_id = (select auth.uid()) and state <> 'invalidated') then
      raise exception 'already_submitted';
    end if;
    raise exception 'test_window_closed';
  end if;

  select array_agg(tq.question_version_id order by
      case when t.shuffle_questions then random() else tq.position::double precision end)
  into v_order
  from public.test_questions tq
  where tq.test_id = p_test_id;

  if t.shuffle_options then
    select jsonb_object_agg(qv.id, keys) into v_opt_orders
    from public.question_versions qv
    cross join lateral (
      select jsonb_agg(k order by random()) as keys
      from (select jsonb_array_elements(qv.options) ->> 'key' as k) s
    ) o
    where qv.id = any (v_order);
  end if;

  insert into public.test_attempts
    (test_id, student_id, expires_at, device_id, session_id, question_order, option_orders)
  values (
    p_test_id, (select auth.uid()),
    least(now() + t.duration_minutes * interval '1 minute', t.closes_at),
    p_device_id,
    nullif(auth.jwt() ->> 'session_id', '')::uuid,
    v_order, v_opt_orders
  )
  on conflict (test_id, student_id) where state <> 'invalidated' do nothing;

  select id into v_aid from public.test_attempts
  where test_id = p_test_id and student_id = (select auth.uid()) and state <> 'invalidated';

  perform public.finalize_if_expired(v_aid);
  select * into a from public.test_attempts where id = v_aid;

  if a.state = 'submitted' then
    raise exception 'already_submitted';
  end if;
  if a.device_id <> p_device_id then
    raise exception 'attempt_locked_other_device';
  end if;

  select jsonb_agg(q order by q -> 'idx') into v_questions
  from (
    select jsonb_build_object(
      'idx', ord.idx,
      'question_version_id', qv.id,
      'stem', qv.stem,
      'options', case
        when a.option_orders is not null and a.option_orders ? qv.id::text then (
          select jsonb_agg(opt order by k.kidx)
          from jsonb_array_elements_text(a.option_orders -> qv.id::text) with ordinality k(key, kidx)
          join lateral (
            select o as opt from jsonb_array_elements(qv.options) o
            where o ->> 'key' = k.key
          ) m on true
        )
        else qv.options
      end
    ) as q
    from unnest(a.question_order) with ordinality ord(qv_id, idx)
    join public.question_versions qv on qv.id = ord.qv_id
  ) qs;

  select coalesce(jsonb_agg(jsonb_build_object(
    'question_version_id', question_version_id,
    'selected_key', trim(selected_key::text),
    'marked_for_review', marked_for_review,
    'save_seq', save_seq
  )), '[]'::jsonb) into v_answers
  from public.attempt_answers where attempt_id = a.id;

  return jsonb_build_object(
    'attempt_id', a.id,
    'started_at', a.started_at,
    'expires_at', a.expires_at,
    'server_now', now(),
    'test_title', t.title,
    'questions', coalesce(v_questions, '[]'::jsonb),
    'answers', v_answers
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin account-status RPC (disposition required when a live attempt exists)
-- ---------------------------------------------------------------------------
create or replace function public.set_account_status(
  p_student_id uuid,
  p_status text,
  p_attempt_disposition text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_blocking boolean;
  v_attempt public.test_attempts%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_status not in ('active', 'restricted', 'suspended', 'deactivated', 'revoked') then
    raise exception 'invalid account_status %', p_status;
  end if;

  select account_status into v_old from public.profiles where id = p_student_id;
  if not found then
    raise exception 'profile not found';
  end if;

  v_blocking := p_status in ('restricted', 'suspended', 'deactivated', 'revoked');

  if v_blocking and exists (
    select 1 from public.test_attempts
    where student_id = p_student_id and state = 'in_progress'
  ) then
    if p_attempt_disposition is null
       or p_attempt_disposition not in ('leave_in_progress', 'invalidate', 'finalize') then
      raise exception 'attempt_disposition_required';
    end if;
    if p_attempt_disposition = 'invalidate' and coalesce(trim(p_reason), '') = '' then
      raise exception 'reason required';
    end if;

    for v_attempt in
      select * from public.test_attempts
      where student_id = p_student_id and state = 'in_progress'
    loop
      if p_attempt_disposition = 'invalidate' then
        perform public.invalidate_attempt(v_attempt.id, p_reason);
      elsif p_attempt_disposition = 'finalize' then
        update public.test_attempts
        set state = 'submitted',
            submitted_at = now(),
            submit_source = 'admin'
        where id = v_attempt.id and state = 'in_progress';
        perform public.score_attempt(v_attempt.id);
      end if;
      -- leave_in_progress: no attempt mutation
    end loop;
  end if;

  perform set_config('medverse.set_account_status', '1', true);

  update public.profiles
  set account_status = p_status,
      active_session_id = case
        when v_blocking then null
        else active_session_id
      end
  where id = p_student_id;

  perform set_config('medverse.set_account_status', '', true);

  perform public.log_audit(
    'account_status_' || p_status,
    'profile',
    p_student_id,
    jsonb_build_object(
      'from', v_old,
      'to', p_status,
      'attempt_disposition', p_attempt_disposition
    )
  );
end;
$$;

revoke execute on function public.account_allows_lms() from public, anon;
grant execute on function public.account_allows_lms() to authenticated, service_role;

revoke execute on function public.is_main_admin() from public, anon;
grant execute on function public.is_main_admin() to authenticated, service_role;

revoke execute on function public.set_account_status(uuid, text, text, text) from public, anon;
grant execute on function public.set_account_status(uuid, text, text, text) to authenticated, service_role;

revoke execute on function public.register_session() from public, anon;
grant execute on function public.register_session() to authenticated, service_role;

-- Platform globals grant table DML to anon; 0006 never revoked it. Anon must
-- use security-definer RPCs only (docs/database.md, tests/010_rls.sql).
revoke all on all tables in schema public from anon;
