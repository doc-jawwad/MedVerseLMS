select id, title, r2_object_key, r2_byte_size, created_at
from materials
where title ilike '%U200%' or title ilike '%200MB%'
order by created_at desc
limit 10;
