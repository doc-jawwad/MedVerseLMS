-- Uses folder of Sample Free PDF material
insert into materials (
  folder_id, title, description, file_type, kind, status,
  r2_object_key, r2_content_type, r2_byte_size
)
select
  folder_id,
  'Range Reader 100MB',
  'staging range test',
  'pdf',
  'pdf',
  'published',
  'study-content/smoke/reader-100m-1790143187.pdf',
  'application/pdf',
  104857600
from materials
where id = '35182e79-9576-4864-8725-7473072427d5'
returning id;
