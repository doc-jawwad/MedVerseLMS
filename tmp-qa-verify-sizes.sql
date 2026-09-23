select title, r2_byte_size, status, deleted_at is not null as soft_deleted
from materials
where title like 'SZ-mudldg1y%'
order by title;
select name, parent_id is not null as is_child
from material_folders
where name like 'SZ-mudldg1y%'
order by name;
