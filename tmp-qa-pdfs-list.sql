select m.id, left(m.title, 40), coalesce(m.r2_byte_size, 0)
from materials m
where m.kind = 'pdf'
  and m.deleted_at is null
  and m.r2_object_key is not null
order by m.r2_byte_size desc nulls last
limit 8;
