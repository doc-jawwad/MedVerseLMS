-- 0017: denormalized question_count on tests.
-- test_questions is RPC-only for students (docs/permissions.md); a nested
-- PostgREST count() against it returns 0 under student RLS. Students still
-- need to see "N MCQs" on test cards, so maintain a plain counter column.

alter table public.tests add column question_count int not null default 0;

create or replace function public.sync_test_question_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tests
  set question_count = (
    select count(*) from public.test_questions where test_id = coalesce(new.test_id, old.test_id)
  )
  where id = coalesce(new.test_id, old.test_id);
  return null;
end;
$$;

create trigger test_questions_sync_count
  after insert or delete on public.test_questions
  for each row execute function public.sync_test_question_count();

update public.tests t
set question_count = (select count(*) from public.test_questions where test_id = t.id);
