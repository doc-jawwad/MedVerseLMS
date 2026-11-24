-- Private online pen stroke persistence, active session and entitlement.
begin;
select plan(24);
select test_helpers.as_runner();
select * into temp ink_curr from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from ink_curr),'Ink Owner') id into temp ink_owner;
select test_helpers.make_student((select year_id from ink_curr),'Ink Peer') id into temp ink_peer;
select test_helpers.make_admin('Ink Main Admin') id into temp ink_admin;
select test_helpers.make_limited_admin('Ink Staff',array['view_students']) id into temp ink_staff;
select gen_random_uuid() owner_sid,gen_random_uuid() peer_sid,gen_random_uuid() admin_sid,gen_random_uuid() staff_sid,gen_random_uuid() stale_sid into temp ink_sessions;
update public.profiles set active_session_id=(select owner_sid from ink_sessions) where id=(select id from ink_owner);
update public.profiles set active_session_id=(select peer_sid from ink_sessions) where id=(select id from ink_peer);
update public.profiles set active_session_id=(select admin_sid from ink_sessions) where id=(select id from ink_admin);
update public.profiles set active_session_id=(select staff_sid from ink_sessions) where id=(select id from ink_staff);
with ins as (
 insert into public.material_folders(name,year_id,library_type,entitlement)
 values ('Ink QA free notes',(select year_id from ink_curr),'notes','free') returning id
) select id into temp ink_folder from ins;
with ins as (
 insert into public.materials(folder_id,title,kind,status,r2_object_key,r2_content_type,r2_byte_size)
 values ((select id from ink_folder),'Ink QA PDF','pdf','published','study-content/ink-qa/first.pdf','application/pdf',100) returning id
) select id into temp ink_mat from ins;
select gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() c into temp ink_ids;
grant select on ink_curr,ink_owner,ink_peer,ink_admin,ink_staff,ink_sessions,ink_folder,ink_mat,ink_ids to authenticated,anon;

select test_helpers.as_user((select id from ink_owner),(select owner_sid from ink_sessions));
select is(public.pdf_ink_revision((select id from ink_mat)),md5('study-content/ink-qa/first.pdf'),'authorized revision is opaque');
select lives_ok($$insert into public.pdf_ink_strokes(id,material_id,content_revision,page_number,points,color,width)
 values ((select a from ink_ids),(select id from ink_mat),public.pdf_ink_revision((select id from ink_mat)),1,'[[1,2],[3,4]]','#dc2626',2)$$,'owner creates stroke');
select is((select count(*)::int from public.pdf_ink_strokes),1,'owner reads stroke');
select is((select student_id from public.pdf_ink_strokes),(select id from ink_owner),'owner defaults to caller');
select ok(not has_column_privilege('authenticated','public.pdf_ink_strokes','student_id','INSERT'),'owner cannot be forged');
select ok(not has_column_privilege('authenticated','public.pdf_ink_strokes','tenant_id','INSERT'),'tenant cannot be forged');
select ok(not has_table_privilege('authenticated','public.pdf_ink_strokes','UPDATE'),'strokes cannot be updated');
select ok(not public.pdf_ink_points_valid('{"x":1}'),'invalid object rejected');
select ok(not public.pdf_ink_points_valid('[[1,"2"]]'),'invalid point rejected');
select ok(not public.pdf_ink_points_valid('[[1000001,0]]'),'oversized coordinate rejected');
select ok(not public.pdf_ink_points_valid('[]'),'empty rejected');
select ok(not public.pdf_ink_points_valid((select jsonb_agg('[0,0]'::jsonb) from generate_series(1,513))),'point count bounded');
select throws_ok($$insert into public.pdf_ink_strokes(id,material_id,content_revision,page_number,points,color,width)
 values ((select b from ink_ids),(select id from ink_mat),public.pdf_ink_revision((select id from ink_mat)),1,'[[1,"2"]]','#dc2626',2)$$,'23514',null,'database rejects malformed stroke');

select test_helpers.as_user((select id from ink_peer),(select peer_sid from ink_sessions));
select is((select count(*)::int from public.pdf_ink_strokes),0,'peer cannot read');
with gone as (delete from public.pdf_ink_strokes where id=(select a from ink_ids) returning id) select is((select count(*)::int from gone),0,'peer cannot delete');
select test_helpers.as_user((select id from ink_staff),(select staff_sid from ink_sessions));
select is((select count(*)::int from public.pdf_ink_strokes),0,'view_students staff cannot read');
select test_helpers.as_user((select id from ink_admin),(select admin_sid from ink_sessions));
select is((select count(*)::int from public.pdf_ink_strokes),0,'main admin cannot read');
select public.set_resource_entitlement('materials_folder',(select id from ink_folder),'any_subscription');

select test_helpers.as_user((select id from ink_owner),(select owner_sid from ink_sessions));
select is(public.pdf_ink_revision((select id from ink_mat)),null::text,'revoked entitlement denies revision');
select is((select count(*)::int from public.pdf_ink_strokes),0,'revoked entitlement hides existing stroke');
select throws_ok($$insert into public.pdf_ink_strokes(id,material_id,content_revision,page_number,points,color,width)
 values ((select b from ink_ids),(select id from ink_mat),md5('study-content/ink-qa/first.pdf'),1,'[[1,2]]','#dc2626',2)$$,'42501',null,'revoked entitlement denies insert');
select test_helpers.as_user((select id from ink_admin),(select admin_sid from ink_sessions));
select public.set_resource_entitlement('materials_folder',(select id from ink_folder),'free');
select test_helpers.as_user((select id from ink_owner),(select stale_sid from ink_sessions));
select is((select count(*)::int from public.pdf_ink_strokes),0,'stale session cannot read');
select test_helpers.as_runner();
update public.materials set r2_object_key='study-content/ink-qa/replaced.pdf' where id=(select id from ink_mat);
select test_helpers.as_user((select id from ink_owner),(select owner_sid from ink_sessions));
select is((select count(*)::int from public.pdf_ink_strokes),0,'replacement hides old stroke');
select lives_ok($$insert into public.pdf_ink_strokes(id,material_id,content_revision,page_number,points,color,width)
 values ((select c from ink_ids),(select id from ink_mat),public.pdf_ink_revision((select id from ink_mat)),1,'[[1,2]]','#2563eb',3)$$,'new revision can be annotated');
with gone as (delete from public.pdf_ink_strokes where id=(select c from ink_ids) returning id) select is((select count(*)::int from gone),1,'owner deletes current stroke');
select * from finish();
rollback;
