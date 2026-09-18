-- Pre-8J follow-up: notification table grants, read_at-only updates,
-- restore allowed during grace.

grant select, update on table public.student_notifications to authenticated;
grant all on table public.student_notifications to service_role;

create or replace function public.protect_student_notification_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'update' then
    if new.student_id is distinct from old.student_id
       or new.kind is distinct from old.kind
       or new.ref_id is distinct from old.ref_id
       or new.payload is distinct from old.payload
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'notification_immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists student_notifications_immutable on public.student_notifications;
create trigger student_notifications_immutable
  before update on public.student_notifications
  for each row execute function public.protect_student_notification_immutability();

create or replace function public.restore_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
begin
  perform public.require_permission('manage_subscriptions');
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  perform public.expire_due_subscriptions(v_row.student_id);
  select * into v_row from public.subscriptions where id = p_subscription_id;

  if v_row.status is distinct from 'deactivated' then
    raise exception 'subscription_not_deactivated';
  end if;
  if not public.subscription_is_live_at(
    'active', v_row.ends_at, v_row.grace_days, now()
  ) then
    raise exception 'subscription_already_ended';
  end if;
  if exists (
    select 1 from public.subscriptions
    where student_id = v_row.student_id
      and public.subscription_is_live_at(status, ends_at, grace_days, now())
      and id is distinct from p_subscription_id
  ) then
    raise exception 'subscription_already_active';
  end if;

  update public.subscriptions
  set status = 'active',
      activated_by = (select auth.uid()),
      activated_at = now(),
      deactivated_by = null,
      deactivated_at = null
  where id = p_subscription_id;

  perform public.log_audit(
    'subscription_restored',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'old_status', 'deactivated',
      'new_status', 'active'
    )
  );
end;
$$;
