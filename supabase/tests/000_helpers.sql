-- Test helpers: fixture creation + JWT/role impersonation for pgTAP RLS tests.
-- Everything here runs inside a transaction the runner rolls back — no
-- fixture ever persists into real data.

create schema if not exists test_helpers;

-- Tests switch into anon/authenticated mid-transaction and still need to call
-- back into these helpers (e.g. as_runner() to reset), so grant broadly.
grant usage on schema test_helpers to anon, authenticated;
alter default privileges in schema test_helpers grant execute on functions to anon, authenticated;

-- Impersonate a signed-in user for the rest of the transaction (mirrors what
-- PostgREST sets from a real JWT). auth.uid()/auth.jwt() read these GUCs.
create or replace function test_helpers.as_user(p_user_id uuid, p_session_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated', 'session_id', p_session_id)::text,
    true);
  set local role authenticated;
end;
$$;

create or replace function test_helpers.as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end;
$$;

-- Reset to the powerful test-runner role (bypasses RLS) for fixture setup.
-- Must also clear the JWT claims GUC — set_config(..., true) persists across
-- role changes for the rest of the transaction, so a leftover claim from a
-- prior as_user() would otherwise make auth.uid() still resolve to that user
-- even after the role itself is reset (e.g. tripping protect_profile_role()).
create or replace function test_helpers.as_runner()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Create a real (transaction-scoped) auth.users row so handle_new_user()
-- fires normally, then an active enrollment in the given year.
create or replace function test_helpers.make_student(p_year_id uuid, p_name text default 'Test Student')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform test_helpers.as_runner();
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     v_id || '@test.invalid', '', now(), now(), now(), '{}',
     jsonb_build_object('full_name', p_name));
  insert into public.enrollments (student_id, year_id, status)
  values (v_id, p_year_id, 'active');
  return v_id;
end;
$$;

-- Curriculum fixtures. Reuses year 1 (seeded, otherwise idle in these tests)
-- and creates uniquely-named subject/book/chapter/topic under it so fixtures
-- never collide with real seeded data or each other across test files.
create or replace function test_helpers.make_curriculum()
returns table (year_id uuid, subject_id uuid, book_id uuid, chapter_id uuid, topic_id uuid)
language plpgsql as $$
declare
  v_year uuid; v_subject uuid; v_book uuid; v_chapter uuid; v_topic uuid;
  v_tag text := 'PGTAP_' || replace(gen_random_uuid()::text, '-', '');
begin
  perform test_helpers.as_runner();
  select id into v_year from public.years where year_number = 1;
  insert into public.subjects (year_id, name) values (v_year, v_tag) returning id into v_subject;
  insert into public.books (subject_id, name) values (v_subject, v_tag) returning id into v_book;
  insert into public.chapters (book_id, name) values (v_book, v_tag) returning id into v_chapter;
  insert into public.topics (chapter_id, name) values (v_chapter, v_tag) returning id into v_topic;
  return query select v_year, v_subject, v_book, v_chapter, v_topic;
end;
$$;

-- A single approved question with a known correct_key, ready for tests/practice.
-- Inserted directly (not via the create_question RPC) because that RPC's
-- is_admin() gate reads auth.uid(), and fixture setup runs with RLS bypassed
-- as the runner role rather than impersonating any particular admin.
create or replace function test_helpers.make_question(p_topic_id uuid, p_correct_key char default 'A')
returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_version uuid;
  v_stem text := 'PGTAP fixture question ' || gen_random_uuid()::text;
  v_options jsonb := jsonb_build_array(
    jsonb_build_object('key','A','text','Option A'),
    jsonb_build_object('key','B','text','Option B'),
    jsonb_build_object('key','C','text','Option C'),
    jsonb_build_object('key','D','text','Option D')
  );
begin
  perform test_helpers.as_runner();
  insert into public.questions (topic_id, status, difficulty, content_hash, stem_normalized)
  values (p_topic_id, 'approved', 'medium',
    public.question_content_hash(v_stem, v_options, p_correct_key),
    public.normalize_stem(v_stem))
  returning id into v_id;
  insert into public.question_versions (question_id, version_no, stem, options, correct_key, explanation, reference)
  values (v_id, 1, v_stem, v_options, p_correct_key, 'fixture explanation', 'fixture reference')
  returning id into v_version;
  update public.questions set current_version_id = v_version where id = v_id;
  return v_id;
end;
$$;

-- A published test with p_count fixture questions, open now, audience-scoped
-- to the given year. Returns the test id.
create or replace function test_helpers.make_published_test(
  p_topic_id uuid, p_year_id uuid, p_count int default 3,
  p_duration_minutes int default 60, p_negative_mark numeric default 0
)
returns uuid language plpgsql as $$
declare
  v_test uuid;
  v_admin uuid;
  i int;
  v_qid uuid;
begin
  perform test_helpers.as_runner();
  insert into public.tests
    (title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions)
  values
    ('PGTAP fixture test', p_year_id, 'draft', now() - interval '1 minute',
     now() + interval '2 hours', p_duration_minutes, p_negative_mark, 1)
  returning id into v_test;

  for i in 1..p_count loop
    v_qid := test_helpers.make_question(p_topic_id, 'A');
    insert into public.test_questions (test_id, question_id, position)
    values (v_test, v_qid, i);
  end loop;

  insert into public.test_audiences (test_id, year_id) values (v_test, p_year_id);

  -- publish_test() re-checks is_admin() via auth.uid(), so impersonate one
  -- briefly rather than replicating its freeze logic here.
  v_admin := test_helpers.make_admin();
  perform test_helpers.as_user(v_admin, gen_random_uuid());
  perform public.publish_test(v_test);
  perform test_helpers.as_runner();
  return v_test;
end;
$$;

create or replace function test_helpers.make_admin(p_name text default 'Test Admin')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform test_helpers.as_runner();
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     v_id || '@test.invalid', '', now(), now(), now(), '{}',
     jsonb_build_object('full_name', p_name));
  update public.profiles set role = 'admin' where id = v_id;
  return v_id;
end;
$$;

-- Belt-and-suspenders: explicit grant regardless of default-privilege ordering.
grant execute on all functions in schema test_helpers to anon, authenticated;
