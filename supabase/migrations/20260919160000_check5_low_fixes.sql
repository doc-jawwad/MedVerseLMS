-- Security Check 5 Low fixes:
-- 1) authorize_payment_screenshot_discard — orphan/pending/admin rules
-- 2) materials.drive_url https-only CHECK (matches admin UI)
-- 3) revoke direct client EXECUTE on log_audit (internal RPC callers only)

-- ---------------------------------------------------------------------------
-- Low 1: payment-proof discard authorization
-- ---------------------------------------------------------------------------
create or replace function public.authorize_payment_screenshot_discard(
  p_object_key text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Admin reject/cleanup: key may still be stored on a non-pending row.
  if public.has_permission('review_subscription_applications') then
    if exists (
      select 1
      from public.subscription_applications a
      where a.screenshot_object_key = p_object_key
    ) then
      return p_object_key;
    end if;
    raise exception 'screenshot_discard_denied';
  end if;

  -- Student path: active LMS account + own key prefix (same shape as attach).
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  perform public.assert_own_screenshot_object_key(v_uid, p_object_key);

  -- Never delete a proof currently attached to any application row.
  -- Orphan cleanup only (failed create/update; prior key after successful replace).
  if exists (
    select 1
    from public.subscription_applications a
    where a.screenshot_object_key = p_object_key
  ) then
    raise exception 'screenshot_discard_denied';
  end if;

  return p_object_key;
end;
$$;

revoke execute on function public.authorize_payment_screenshot_discard(text)
  from public, anon;
grant execute on function public.authorize_payment_screenshot_discard(text)
  to authenticated, service_role;

comment on function public.authorize_payment_screenshot_discard(text) is
  'Authorizes R2 discard of a payment-proof object key. Students may discard only unattached orphan keys under their prefix (account_allows_lms). Keys attached to any application status are denied for students. Admins with review_subscription_applications may discard keys still referenced by an application (reject cleanup).';

-- ---------------------------------------------------------------------------
-- Low 2: materials.drive_url — https-only at the DB boundary
-- ---------------------------------------------------------------------------
-- Matches src/lib/actions/materials.ts validDriveUrl (https: only).
-- Existing fixtures/seed already use https://drive.google.com/...
alter table public.materials
  drop constraint if exists materials_drive_url_https;

alter table public.materials
  add constraint materials_drive_url_https
  check (drive_url ~ '^https://[^[:space:]]+$');

comment on column public.materials.drive_url is
  'Google Drive (or other) https URL opened via open_material. CHECK requires https without whitespace; app UI validates the same.';

-- ---------------------------------------------------------------------------
-- Low 3: log_audit — no direct client EXECUTE
-- ---------------------------------------------------------------------------
-- Mutation SECURITY DEFINER RPCs still call log_audit as the function owner.
-- Keep the is_admin() guard as defense-in-depth for any privileged caller.
revoke execute on function public.log_audit(text, text, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.log_audit(text, text, uuid, jsonb)
  to service_role;

comment on function public.log_audit(text, text, uuid, jsonb) is
  'Insert-only audit helper. EXECUTE revoked from authenticated/anon/public — only SECURITY DEFINER mutation RPCs (and service_role) may call it. Still requires is_admin() for the JWT actor.';
