update materials m
set deleted_at = now()
where deleted_at is null
  and folder_id in (
    select id from material_folders
    where library_type in ('past_papers','other_services')
      and (name like 'QA%' or name like 'QA2%' or name like 'ACC-%' or name like 'SZ-%' or name like 'OV-%')
  );

update material_folders
set deleted_at = now()
where library_type in ('past_papers','other_services')
  and deleted_at is null
  and (name like 'QA%' or name like 'QA2%' or name like 'ACC-%' or name like 'SZ-%' or name like 'OV-%');

select count(*) as left_pp from material_folders
where library_type='past_papers' and deleted_at is null
  and (name like 'ACC-%' or name like 'SZ-%' or name like 'OV-%' or name like 'QA%');
