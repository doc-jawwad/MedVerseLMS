-- 0021: performance pass — indexes for query patterns that lacked one.
-- Postgres does NOT auto-index foreign key columns; these are join/filter
-- paths hit by the analytics RPCs (question_difficulty_report,
-- admin_student_profile) that had no supporting index.

create index if not exists attempt_answers_question_version_idx
  on public.attempt_answers (question_version_id);

create index if not exists practice_answers_question_version_idx
  on public.practice_answers (question_version_id);

create index if not exists enrollments_student_idx
  on public.enrollments (student_id);
