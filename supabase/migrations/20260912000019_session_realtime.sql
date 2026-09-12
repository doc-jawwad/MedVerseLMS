-- 0019: realtime session-kick notification (Phase 11 hardening)
-- Lets the client detect Layer-1 eviction immediately instead of waiting for
-- the next navigation to hit proxy.ts (docs/permissions.md).

create or replace function public.current_session_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

alter publication supabase_realtime add table public.profiles;
