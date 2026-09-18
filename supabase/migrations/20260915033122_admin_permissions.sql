-- Step 8C: granular admin permissions (docs/permissions.md, docs/database.md).
-- Role remains student | admin. Main Admin (profiles.is_main_admin) has every
-- permission. Other admins need explicit admin_permissions rows.
-- Presets are UI-only and are not modeled here.
--
-- Curriculum tree CRUD stays is_admin() FOR ALL until a dedicated permission
-- code is approved (docs/permissions.md pending owner decision #2).

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.permissions (
  code text primary key,
  tenant_id uuid not null default public.default_tenant(),
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger permissions_updated_at
  before update on public.permissions
  for each row execute function public.set_updated_at();

create table public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  admin_id uuid not null references public.profiles (id) on delete cascade,
  permission_code text not null references public.permissions (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admin_id, permission_code)
);

create index admin_permissions_admin_idx on public.admin_permissions (admin_id);
create index admin_permissions_code_idx on public.admin_permissions (permission_code);

create trigger admin_permissions_updated_at
  before update on public.admin_permissions
  for each row execute function public.set_updated_at();

insert into public.permissions (code, label) values
  ('manage_admins', 'Manage admins and permissions'),
  ('manage_system_settings', 'Manage system settings'),
  ('view_students', 'View students'),
  ('manage_students', 'Edit student profile fields'),
  ('activate_students', 'Restore students to active'),
  ('restrict_students', 'Restrict, suspend, deactivate, or revoke students'),
  ('manage_subscriptions', 'Manage subscriptions'),
  ('review_subscription_applications', 'Review subscription applications'),
  ('manage_payment_settings', 'Manage payment settings'),
  ('grant_resource_access', 'Grant or revoke resource access'),
  ('manage_year_changes', 'Manage class year changes'),
  ('edit_questions', 'Edit questions'),
  ('import_questions', 'Import questions'),
  ('publish_tests', 'Publish and manage tests'),
  ('manage_materials', 'Manage materials'),
  ('view_analytics', 'View analytics');

-- Preserve existing admin access: every current admin is Main Admin
-- (docs/permissions.md). Do not strip access. Future limited admins are
-- created via set_admin_role without this flag.
update public.profiles
set is_main_admin = true
where role = 'admin'
  and is_main_admin is distinct from true;

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------
-- has_permission uses authenticated JWT identity (auth.uid()) and profiles /
-- admin_permissions rows. Never user_metadata / frontend state.
create or replace function public.has_permission(p_code text)
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
        from public.admin_permissions ap
        where ap.admin_id = (select auth.uid())
          and ap.permission_code = p_code
      )
    );
$$;

create or replace function public.require_permission(p_code text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.has_permission(p_code) then
    return;
  end if;
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  raise exception 'permission_denied';
end;
$$;

revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated, service_role;

revoke execute on function public.require_permission(text) from public, anon;
grant execute on function public.require_permission(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profile / enrollment triggers: permission-scoped, last Main Admin locked
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_gated_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_main_admin is distinct from old.is_main_admin then
    if (select auth.uid()) is not null
       and not public.has_permission('manage_admins') then
      if not public.is_admin() then
        raise exception 'is_main_admin changes require admin';
      else
        raise exception 'permission_denied';
      end if;
    end if;
    if old.is_main_admin and not new.is_main_admin
       and not exists (
         select 1 from public.profiles
         where is_main_admin and id != old.id
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

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if old.role = 'admin' and new.role is distinct from 'admin'
       and old.is_main_admin
       and not exists (
         select 1 from public.profiles
         where is_main_admin and id != old.id
       ) then
      raise exception 'cannot demote the last Main Admin';
    end if;

    if (select auth.uid()) is not null
       and not public.has_permission('manage_admins') then
      if not public.is_admin() then
        raise exception 'role changes require admin';
      else
        raise exception 'permission_denied';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_enrollment_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'update'
     and (select auth.uid()) is not null
     and not public.has_permission('manage_year_changes')
     and (
       new.year_id is distinct from old.year_id
       or new.student_id is distinct from old.student_id
       or new.status is distinct from old.status
     ) then
    if not public.is_admin() then
      raise exception 'students cannot change class assignment';
    else
      raise exception 'permission_denied';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_admin_permission_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.admin_id and role = 'admin'
  ) then
    raise exception 'permissions can only be granted to admins';
  end if;
  return new;
end;
$$;

drop trigger if exists admin_permissions_protect_target on public.admin_permissions;
create trigger admin_permissions_protect_target
  before insert or update on public.admin_permissions
  for each row execute function public.protect_admin_permission_target();

-- ---------------------------------------------------------------------------
-- Patch existing admin RPCs: first is_admin() gate → require_permission(code)
-- ---------------------------------------------------------------------------
create or replace function public._medverse_replace_admin_gate(p_regproc text, p_code text)
returns void
language plpgsql
set search_path = public
as $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef(p_regproc::regprocedure);
  patched := regexp_replace(
    def,
    'if not public\.is_admin\(\) then[[:space:]]*raise exception ''admin only'';[[:space:]]*end if;',
    format('perform public.require_permission(%L);', p_code)
  );
  if patched is not distinct from def then
    raise exception 'admin-gate patch missed for %', p_regproc;
  end if;
  if patched !~ '^CREATE OR REPLACE FUNCTION' then
    patched := regexp_replace(patched, '^CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
  end if;
  execute patched;
end;
$$;

select public._medverse_replace_admin_gate('public.create_question_version(uuid, text, jsonb, char, text, text)', 'edit_questions');
select public._medverse_replace_admin_gate('public.import_question_batch(uuid, jsonb, boolean)', 'import_questions');
select public._medverse_replace_admin_gate('public.validate_test(uuid)', 'publish_tests');
select public._medverse_replace_admin_gate('public.publish_test(uuid)', 'publish_tests');
select public._medverse_replace_admin_gate('public.close_test_now(uuid)', 'publish_tests');
select public._medverse_replace_admin_gate('public.invalidate_test(uuid, text)', 'publish_tests');
select public._medverse_replace_admin_gate('public.void_test_question(uuid, uuid, text)', 'publish_tests');
select public._medverse_replace_admin_gate('public.reorder_test_question(uuid, uuid, text)', 'publish_tests');
select public._medverse_replace_admin_gate('public.invalidate_attempt(uuid, text)', 'publish_tests');
select public._medverse_replace_admin_gate('public.set_enrollment_status(uuid, text)', 'manage_year_changes');
select public._medverse_replace_admin_gate('public.promote_student(uuid)', 'manage_year_changes');
select public._medverse_replace_admin_gate('public.admin_platform_summary()', 'view_analytics');
select public._medverse_replace_admin_gate('public.question_difficulty_report(integer)', 'view_analytics');
select public._medverse_replace_admin_gate('public.admin_student_profile(uuid)', 'view_students');
select public._medverse_replace_admin_gate('public.test_summary(uuid)', 'view_analytics');

drop function public._medverse_replace_admin_gate(text, text);

-- create_question: edit_questions, or import_questions when called from import.
create or replace function public.create_question(
  p_topic_id uuid,
  p_stem text,
  p_options jsonb,
  p_correct_key char,
  p_explanation text default '',
  p_reference text default '',
  p_difficulty text default 'medium',
  p_tags text[] default '{}',
  p_status text default 'draft'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_id uuid;
  v_version_id uuid;
begin
  if not (
    public.has_permission('edit_questions')
    or public.has_permission('import_questions')
  ) then
    if not public.is_admin() then
      raise exception 'admin only';
    else
      raise exception 'permission_denied';
    end if;
  end if;
  if p_status not in ('draft', 'review', 'approved') then
    raise exception 'new questions must be draft, review or approved';
  end if;
  perform public.validate_question_content(p_options, p_correct_key);

  insert into public.questions (topic_id, status, difficulty, tags, content_hash, stem_normalized, created_by)
  values (
    p_topic_id, p_status, p_difficulty, coalesce(p_tags, '{}'),
    public.question_content_hash(p_stem, p_options, p_correct_key),
    public.normalize_stem(p_stem),
    (select auth.uid())
  )
  returning id into v_question_id;

  insert into public.question_versions
    (question_id, version_no, stem, options, correct_key, explanation, reference, created_by)
  values
    (v_question_id, 1, p_stem, p_options, p_correct_key,
     coalesce(p_explanation, ''), coalesce(p_reference, ''), (select auth.uid()))
  returning id into v_version_id;

  update public.questions set current_version_id = v_version_id where id = v_question_id;
  return v_question_id;
end;
$$;

-- set_account_status: activate vs restrict. Inline attempt invalidate so a
-- restrict_students admin is not forced to also hold publish_tests.
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
  if p_status = 'active' then
    perform public.require_permission('activate_students');
  elsif p_status in ('restricted', 'suspended', 'deactivated', 'revoked') then
    perform public.require_permission('restrict_students');
  else
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
        update public.test_attempts
        set state = 'invalidated',
            invalidated_reason = p_reason,
            invalidated_by = (select auth.uid())
        where id = v_attempt.id and state = 'in_progress';
        perform public.log_audit(
          'attempt_invalidated',
          'attempt',
          v_attempt.id,
          jsonb_build_object('reason', p_reason, 'source', 'set_account_status')
        );
      elsif p_attempt_disposition = 'finalize' then
        update public.test_attempts
        set state = 'submitted',
            submitted_at = now(),
            submit_source = 'admin'
        where id = v_attempt.id and state = 'in_progress';
        perform public.score_attempt(v_attempt.id);
      end if;
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

-- ---------------------------------------------------------------------------
-- Admin-management primitives (no UI in this step)
-- ---------------------------------------------------------------------------
create or replace function public.grant_admin_permission(p_admin_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_permission('manage_admins');
  if not exists (
    select 1 from public.profiles where id = p_admin_id and role = 'admin'
  ) then
    raise exception 'target is not an admin';
  end if;
  insert into public.admin_permissions (admin_id, permission_code)
  values (p_admin_id, p_code)
  on conflict (admin_id, permission_code) do nothing;
  perform public.log_audit(
    'admin_permission_granted',
    'profile',
    p_admin_id,
    jsonb_build_object('code', p_code)
  );
end;
$$;

create or replace function public.revoke_admin_permission(p_admin_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  perform public.require_permission('manage_admins');
  delete from public.admin_permissions
  where admin_id = p_admin_id and permission_code = p_code;
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    perform public.log_audit(
      'admin_permission_revoked',
      'profile',
      p_admin_id,
      jsonb_build_object('code', p_code)
    );
  end if;
end;
$$;

create or replace function public.set_admin_role(p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  perform public.require_permission('manage_admins');

  select role into v_old from public.profiles where id = p_user_id;
  if not found then
    raise exception 'profile not found';
  end if;

  if p_is_admin then
    update public.profiles
    set role = 'admin',
        is_main_admin = false
    where id = p_user_id;
    perform public.log_audit(
      'admin_role_granted',
      'profile',
      p_user_id,
      jsonb_build_object('from', v_old, 'to', 'admin')
    );
  else
    if exists (
      select 1 from public.profiles
      where id = p_user_id and is_main_admin
    ) and not exists (
      select 1 from public.profiles
      where is_main_admin and id != p_user_id
    ) then
      raise exception 'cannot demote the last Main Admin';
    end if;
    delete from public.admin_permissions where admin_id = p_user_id;
    update public.profiles
    set role = 'student',
        is_main_admin = false
    where id = p_user_id;
    perform public.log_audit(
      'admin_role_revoked',
      'profile',
      p_user_id,
      jsonb_build_object('from', v_old, 'to', 'student')
    );
  end if;
end;
$$;

create or replace function public.set_main_admin(p_user_id uuid, p_is_main boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_permission('manage_admins');
  if not exists (
    select 1 from public.profiles where id = p_user_id and role = 'admin'
  ) then
    raise exception 'target is not an admin';
  end if;
  if not p_is_main
     and exists (select 1 from public.profiles where id = p_user_id and is_main_admin)
     and not exists (
       select 1 from public.profiles where is_main_admin and id != p_user_id
     ) then
    raise exception 'cannot demote the last Main Admin';
  end if;
  update public.profiles
  set is_main_admin = p_is_main
  where id = p_user_id;
  perform public.log_audit(
    case when p_is_main then 'main_admin_granted' else 'main_admin_revoked' end,
    'profile',
    p_user_id,
    jsonb_build_object('is_main_admin', p_is_main)
  );
end;
$$;

create or replace function public.grant_access(
  p_student_id uuid,
  p_grant_type text,
  p_subject_id uuid default null,
  p_test_id uuid default null,
  p_folder_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_permission('grant_resource_access');
  insert into public.access_grants (
    student_id, grant_type, subject_id, test_id, folder_id, granted_by
  ) values (
    p_student_id, p_grant_type, p_subject_id, p_test_id, p_folder_id, (select auth.uid())
  )
  returning id into v_id;
  perform public.log_audit(
    'access_granted',
    'access_grant',
    v_id,
    jsonb_build_object(
      'student_id', p_student_id,
      'grant_type', p_grant_type,
      'subject_id', p_subject_id,
      'test_id', p_test_id,
      'folder_id', p_folder_id
    )
  );
  return v_id;
end;
$$;

create or replace function public.revoke_access(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_grants%rowtype;
begin
  perform public.require_permission('grant_resource_access');
  update public.access_grants
  set revoked_at = now()
  where id = p_grant_id and revoked_at is null
  returning * into v_row;
  if not found then
    raise exception 'grant not found or already revoked';
  end if;
  perform public.log_audit(
    'access_revoked',
    'access_grant',
    p_grant_id,
    jsonb_build_object('student_id', v_row.student_id, 'grant_type', v_row.grant_type)
  );
end;
$$;

revoke execute on function public.grant_admin_permission(uuid, text) from public, anon;
grant execute on function public.grant_admin_permission(uuid, text) to authenticated, service_role;
revoke execute on function public.revoke_admin_permission(uuid, text) from public, anon;
grant execute on function public.revoke_admin_permission(uuid, text) to authenticated, service_role;
revoke execute on function public.set_admin_role(uuid, boolean) from public, anon;
grant execute on function public.set_admin_role(uuid, boolean) to authenticated, service_role;
revoke execute on function public.set_main_admin(uuid, boolean) from public, anon;
grant execute on function public.set_main_admin(uuid, boolean) to authenticated, service_role;
revoke execute on function public.grant_access(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.grant_access(uuid, text, uuid, uuid, uuid) to authenticated, service_role;
revoke execute on function public.revoke_access(uuid) from public, anon;
grant execute on function public.revoke_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: admin SELECT may use is_admin(); sensitive writes are permissioned.
-- Curriculum years/subjects/books/chapters/topics stay is_admin() FOR ALL.
-- ---------------------------------------------------------------------------
alter table public.permissions enable row level security;
alter table public.admin_permissions enable row level security;

create policy permissions_admin_select on public.permissions
  for select using (public.is_admin());

create policy admin_permissions_admin_select on public.admin_permissions
  for select using (public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update
  using (
    id = (select auth.uid())
    or public.has_permission('manage_students')
  )
  with check (
    id = (select auth.uid())
    or public.has_permission('manage_students')
  );

drop policy if exists enrollments_admin_write on public.enrollments;
drop policy if exists access_grants_admin_write on public.access_grants;
drop policy if exists test_attempts_admin_write on public.test_attempts;

drop policy if exists questions_admin_all on public.questions;
create policy questions_admin_select on public.questions
  for select using (public.is_admin());
create policy questions_admin_insert on public.questions
  for insert with check (public.has_permission('edit_questions'));
create policy questions_admin_update on public.questions
  for update using (public.has_permission('edit_questions'))
  with check (public.has_permission('edit_questions'));
create policy questions_admin_delete on public.questions
  for delete using (public.has_permission('edit_questions'));

drop policy if exists question_versions_admin_insert on public.question_versions;
create policy question_versions_admin_insert on public.question_versions
  for insert with check (public.has_permission('edit_questions'));

drop policy if exists import_batches_admin_all on public.import_batches;
create policy import_batches_admin_select on public.import_batches
  for select using (public.is_admin());
create policy import_batches_admin_insert on public.import_batches
  for insert with check (public.has_permission('import_questions'));
create policy import_batches_admin_update on public.import_batches
  for update using (public.has_permission('import_questions'))
  with check (public.has_permission('import_questions'));
create policy import_batches_admin_delete on public.import_batches
  for delete using (public.has_permission('import_questions'));

drop policy if exists import_rows_admin_all on public.import_rows;
create policy import_rows_admin_select on public.import_rows
  for select using (public.is_admin());
create policy import_rows_admin_insert on public.import_rows
  for insert with check (public.has_permission('import_questions'));
create policy import_rows_admin_update on public.import_rows
  for update using (public.has_permission('import_questions'))
  with check (public.has_permission('import_questions'));
create policy import_rows_admin_delete on public.import_rows
  for delete using (public.has_permission('import_questions'));

drop policy if exists tests_admin_all on public.tests;
create policy tests_admin_select on public.tests
  for select using (public.is_admin());
create policy tests_admin_insert on public.tests
  for insert with check (public.has_permission('publish_tests'));
create policy tests_admin_update on public.tests
  for update using (public.has_permission('publish_tests'))
  with check (public.has_permission('publish_tests'));
create policy tests_admin_delete on public.tests
  for delete using (public.has_permission('publish_tests'));

drop policy if exists test_questions_admin_all on public.test_questions;
create policy test_questions_admin_select on public.test_questions
  for select using (public.is_admin());
create policy test_questions_admin_insert on public.test_questions
  for insert with check (public.has_permission('publish_tests'));
create policy test_questions_admin_update on public.test_questions
  for update using (public.has_permission('publish_tests'))
  with check (public.has_permission('publish_tests'));
create policy test_questions_admin_delete on public.test_questions
  for delete using (public.has_permission('publish_tests'));

drop policy if exists test_audiences_admin_all on public.test_audiences;
create policy test_audiences_admin_select on public.test_audiences
  for select using (public.is_admin());
create policy test_audiences_admin_insert on public.test_audiences
  for insert with check (public.has_permission('publish_tests'));
create policy test_audiences_admin_update on public.test_audiences
  for update using (public.has_permission('publish_tests'))
  with check (public.has_permission('publish_tests'));
create policy test_audiences_admin_delete on public.test_audiences
  for delete using (public.has_permission('publish_tests'));

drop policy if exists material_folders_admin_all on public.material_folders;
create policy material_folders_admin_select on public.material_folders
  for select using (public.is_admin());
create policy material_folders_admin_insert on public.material_folders
  for insert with check (public.has_permission('manage_materials'));
create policy material_folders_admin_update on public.material_folders
  for update using (public.has_permission('manage_materials'))
  with check (public.has_permission('manage_materials'));
create policy material_folders_admin_delete on public.material_folders
  for delete using (public.has_permission('manage_materials'));

drop policy if exists materials_admin_all on public.materials;
create policy materials_admin_select on public.materials
  for select using (public.is_admin());
create policy materials_admin_insert on public.materials
  for insert with check (public.has_permission('manage_materials'));
create policy materials_admin_update on public.materials
  for update using (public.has_permission('manage_materials'))
  with check (public.has_permission('manage_materials'));
create policy materials_admin_delete on public.materials
  for delete using (public.has_permission('manage_materials'));
