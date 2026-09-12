-- 0001: extensions + shared helpers
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Single-academy constant tenant (see docs/database.md). Multi-tenant later = replace default + RLS predicate.
create or replace function public.default_tenant()
returns uuid
language sql
immutable
as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
