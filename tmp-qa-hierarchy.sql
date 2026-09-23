select m.title, m.folder_id, f.name as folder_name
from materials m
join material_folders f on f.id = m.folder_id
where m.title like 'ACC-mudmod8m%'
order by m.title;

select id, name, parent_id from material_folders where name like 'ACC-mudmod8m%';
