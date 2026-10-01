-- Shared R2 purge reference helpers (neutral prerequisite).
-- Used by Content Bin hard-delete paths and payment-proof release.
-- No Content Bin retention/cascade policy and no payment-proof business logic.
--
-- Depends on: r2_purge_queue + enqueue_r2_purge (data spine), plus
-- materials/ospe/pearl/profiles/subscription_applications reference columns.
-- Safe CREATE OR REPLACE: may re-assert defs already present from later seals.

-- ---------------------------------------------------------------------------
-- True when any live DB row still references the object key
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
      select 1 from public.profiles pr where pr.avatar_object_key = p_object_key
      union all
      select 1 from public.subscription_applications sa
      where sa.screenshot_object_key = p_object_key
    )
  end;
$$;

revoke execute on function public.r2_object_still_referenced(text)
  from public, anon, authenticated;
grant execute on function public.r2_object_still_referenced(text)
  to service_role;

comment on function public.r2_object_still_referenced(text) is
  'True when any materials/OSPE/pearl/avatar/payment-proof row still references the R2 object key. Used before enqueue and by purge workers.';

-- ---------------------------------------------------------------------------
-- Enqueue only when reference count is zero (call AFTER clearing/hard-delete)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_r2_purge_if_unreferenced(
  p_object_key text,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_object_key is null then
    return;
  end if;
  if public.r2_object_still_referenced(p_object_key) then
    return;
  end if;
  perform public.enqueue_r2_purge(p_object_key, p_entity_type, p_entity_id);
end;
$$;

revoke execute on function public.enqueue_r2_purge_if_unreferenced(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_r2_purge_if_unreferenced(text, text, uuid)
  to service_role;

comment on function public.enqueue_r2_purge_if_unreferenced(text, text, uuid) is
  'Enqueue R2 purge via enqueue_r2_purge only when no remaining DB entity references the key. Call AFTER hard-delete or clearing the reference.';
