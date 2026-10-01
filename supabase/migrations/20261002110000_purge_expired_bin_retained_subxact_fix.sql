-- Fix: retained_* accounting must not run inside BEGIN…EXCEPTION subtransaction
-- with CONTINUE (PG aborts the subxact and rolls back the counters).
-- Full replace of purge_expired_bin_items from 20261002100000 with corrected loop.

create or replace function public.purge_expired_bin_items()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_retained_count int := 0;
  v_err text;
  v_retained text;
  r record;
  v_keys text[];
  v_key text;
begin
  for r in
    select m.id, m.r2_object_key, m.cover_object_key
    from public.materials m
    where m.deleted_at is not null
      and m.purge_after is not null
      and m.purge_after <= now()
  loop
    begin
      delete from public.materials where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'material', r.id);
      perform public.enqueue_r2_purge_if_unreferenced(r.cover_object_key, 'material', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired material %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('material %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select f.id
    from public.material_folders f
    where f.deleted_at is not null
      and f.purge_after is not null
      and f.purge_after <= now()
  loop
    begin
      if public.folder_has_live_descendants(r.id) then
        raise exception 'folder_has_live_descendants';
      end if;
      v_keys := public.folder_subtree_r2_keys(r.id);
      delete from public.material_folders where id = r.id;
      foreach v_key in array v_keys loop
        perform public.enqueue_r2_purge_if_unreferenced(v_key, 'material_folder', r.id);
      end loop;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired material_folder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('material_folder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id, r2_object_key from public.pearl_points
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.pearl_points where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'pearl_point', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired pearl_point %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('pearl_point %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id, r2_object_key from public.ospe_stations
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.ospe_stations where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'ospe_station', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired ospe_station %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('ospe_station %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.questions
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    if exists (
      select 1 from public.test_questions tq where tq.question_id = r.id
    ) then
      v_retained_count := v_retained_count + 1;
      v_retained := coalesce(v_retained || '; ', '')
        || format('question %s: question_referenced_by_test', r.id);
    else
      begin
        perform set_config('medverse.allow_question_version_purge', '1', true);
        delete from public.practice_answers pa
        using public.question_versions qv
        where pa.question_version_id = qv.id
          and qv.question_id = r.id;
        delete from public.questions where id = r.id;
        perform set_config('medverse.allow_question_version_purge', '', true);
        v_count := v_count + 1;
      exception when others then
        perform set_config('medverse.allow_question_version_purge', '', true);
        raise notice 'purge_expired question %: %', r.id, SQLERRM;
        v_err := coalesce(v_err || '; ', '') || format('question %s: %s', r.id, SQLERRM);
      end;
    end if;
  end loop;

  for r in
    select id from public.prof_session_days
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.prof_session_days where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired prof_session_day %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('prof_session_day %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.one_liners
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.one_liners where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired one_liner %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('one_liner %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.mcq_bank_subfolders
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      if exists (
        select 1 from public.questions q
        where q.mcq_bank_subfolder_id = r.id and q.deleted_at is null
      ) then
        raise exception 'subfolder_not_empty';
      end if;
      delete from public.mcq_bank_subfolders where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired mcq_bank_subfolder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('mcq_bank_subfolder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.mcq_bank_folders
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.mcq_bank_folders where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired mcq_bank_folder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('mcq_bank_folder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  insert into public.purge_log (deleted_count, error_text, retained_count, retained_text)
  values (v_count, v_err, v_retained_count, v_retained);
end;
$$;

comment on function public.purge_expired_bin_items() is
  'Cron hard-delete where purge_after <= now(). Questions with any test_questions row are retained (retained_*), not error_text. Manual purge_content still raises question_referenced_by_test.';
