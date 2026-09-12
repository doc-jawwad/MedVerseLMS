-- 0020: audit_logs.actor_id was missing its FK, so PostgREST could not embed
-- profiles() for the admin audit log viewer. actor_id is null for
-- system-originated entries, so this must stay nullable + on delete set null.

alter table public.audit_logs
  add constraint audit_logs_actor_fk
  foreign key (actor_id) references public.profiles (id) on delete set null;
