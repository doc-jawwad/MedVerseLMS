-- Auto-fill subscriptions.year_id for backward-compatible inserts.
create or replace function public.subscriptions_default_year_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.year_id is null then
    select e.year_id into new.year_id
    from public.enrollments e
    where e.student_id = new.student_id and e.status = 'active';
  end if;
  if new.year_id is null then
    select id into new.year_id from public.years where year_number = 1 limit 1;
  end if;
  if new.year_id is null then
    raise exception 'invalid_year';
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_default_year_id on public.subscriptions;
create trigger subscriptions_default_year_id
  before insert or update on public.subscriptions
  for each row execute function public.subscriptions_default_year_id();

-- Same for applications (direct fixture inserts).
create or replace function public.subscription_applications_default_year_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.year_id is null then
    select e.year_id into new.year_id
    from public.enrollments e
    where e.student_id = new.student_id and e.status = 'active';
  end if;
  if new.year_id is null then
    select id into new.year_id from public.years where year_number = 1 limit 1;
  end if;
  if new.year_id is null then
    raise exception 'invalid_year';
  end if;
  return new;
end;
$$;

drop trigger if exists subscription_applications_default_year_id
  on public.subscription_applications;
create trigger subscription_applications_default_year_id
  before insert or update on public.subscription_applications
  for each row execute function public.subscription_applications_default_year_id();
