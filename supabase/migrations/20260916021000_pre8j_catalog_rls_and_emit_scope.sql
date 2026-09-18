-- Pre-8J: catalog RLS follows current year OR explicit grant; emit warnings
-- cannot target another student.

create or replace function public.emit_subscription_expiry_warnings(
  p_student_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_inserted int;
  v_student uuid := p_student_id;
begin
  if v_student is null then
    if public.is_admin() or (select auth.uid()) is null then
      null;
    else
      v_student := (select auth.uid());
    end if;
  elsif (select auth.uid()) is not null
     and not public.is_admin()
     and v_student is distinct from (select auth.uid()) then
    v_student := (select auth.uid());
  end if;

  insert into public.student_notifications (student_id, kind, ref_id, payload)
  select
    s.student_id,
    k.kind,
    s.id,
    jsonb_build_object('ends_at', s.ends_at, 'grace_days', s.grace_days)
  from public.subscriptions s
  cross join lateral (
    select unnest(array[
      'subscription_expiry_7d',
      'subscription_expiry_3d',
      'subscription_expiry_1d'
    ]) as kind
  ) k
  where s.status = 'active'
    and s.ends_at > now()
    and (
      (k.kind = 'subscription_expiry_7d' and s.ends_at - now() <= interval '7 days')
      or (k.kind = 'subscription_expiry_3d' and s.ends_at - now() <= interval '3 days')
      or (k.kind = 'subscription_expiry_1d' and s.ends_at - now() <= interval '1 day')
    )
    and (v_student is null or s.student_id = v_student)
  on conflict (student_id, kind, ref_id) do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
$$;

drop policy if exists subjects_student_select on public.subjects;
create policy subjects_student_select on public.subjects
  for select using (public.can_view_practice_subject(id));

drop policy if exists books_student_select on public.books;
create policy books_student_select on public.books
  for select using (
    public.account_allows_lms()
    and (
      public.has_active_enrollment(year_id)
      or public.has_resource_grant('practice_subject', subject_id, null, null)
    )
  );

drop policy if exists chapters_student_select on public.chapters;
create policy chapters_student_select on public.chapters
  for select using (
    public.account_allows_lms()
    and (
      public.has_active_enrollment(year_id)
      or public.has_resource_grant('practice_subject', subject_id, null, null)
    )
  );

drop policy if exists topics_student_select on public.topics;
create policy topics_student_select on public.topics
  for select using (
    public.account_allows_lms()
    and (
      public.has_active_enrollment(year_id)
      or public.has_resource_grant('practice_subject', subject_id, null, null)
    )
  );
