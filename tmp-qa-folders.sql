select id, name, year_id, parent_id, library_type, deleted_at, sort_order, entitlement
from material_folders
where library_type = 'past_papers'
  and (name like 'QA%' or name like 'QA2%')
order by created_at desc nulls last, name
limit 40;
