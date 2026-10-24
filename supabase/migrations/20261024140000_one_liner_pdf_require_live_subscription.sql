-- Prof. Session one_liner source PDF: student authorize requires live subscription.
-- architecture.md §2c freezes the entire Prof. Session surface as subscription-locked;
-- page gates already use hasLiveAccess / SectionLock. Enrollment alone is not enough
-- for private PDF bytes (UUID-guessing bypass of the UI lock).

create or replace function public.authorize_one_liner_object(p_one_liner_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.one_liners%rowtype;
begin
  select * into v_row from public.one_liners where id = p_one_liner_id;
  if not found or v_row.r2_object_key is null or v_row.deleted_at is not null then
    raise exception 'one_liner_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_can_access_year(v_row.year_id) then
      raise exception 'one_liner_object_denied';
    end if;
    return v_row.r2_object_key;
  end if;

  if v_row.status is distinct from 'published' then
    raise exception 'one_liner_object_denied';
  end if;

  if not public.has_active_enrollment(v_row.year_id) then
    raise exception 'one_liner_object_denied';
  end if;

  -- Prof. Session surface is subscription-locked (architecture.md §2c).
  if not public.has_live_subscription() then
    raise exception 'one_liner_object_denied';
  end if;

  return v_row.r2_object_key;
end;
$$;

revoke execute on function public.authorize_one_liner_object(uuid) from public, anon;
grant execute on function public.authorize_one_liner_object(uuid) to authenticated, service_role;

comment on function public.authorize_one_liner_object(uuid) is
  'Returns study-content/ object key for a one_liner PDF when admin (manage_materials + year) or enrolled student with a live subscription viewing a published non-deleted row.';
