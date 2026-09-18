-- VPS-only stub so 00002 can FK profiles(id) to auth.users.
-- Cloud Auth is the identity store; this table is not populated.
-- Later migration 20260914000002 drops the FK. Do not run against Cloud.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
