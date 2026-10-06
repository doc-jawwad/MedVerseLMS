-- Observability only: enable pg_stat_statements in each MedVerse database.
-- Requires shared_preload_libraries to include pg_stat_statements (restart).
-- Does not change RLS, application schema, or query behavior.

create extension if not exists pg_stat_statements;

comment on extension pg_stat_statements is
  'Production PostgreSQL query statistics (observability). No application behavior change.';
