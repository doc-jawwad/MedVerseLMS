select m.title, m.deleted_at is not null as soft_deleted, m.r2_object_key is not null as has_r2_key, m.r2_byte_size
from materials m
where m.title like 'ACC-mudmod8m%'
order by m.title;

select f.name, f.parent_id is not null as is_child, f.deleted_at is not null as soft_deleted
from material_folders f
where f.name like 'ACC-mudmod8m%'
order by f.name;
