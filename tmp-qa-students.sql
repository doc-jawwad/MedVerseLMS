\dt *year*
select table_name from information_schema.tables where table_schema='public' and table_name ilike '%year%' or table_name ilike '%enroll%';
select p.email, p.role, e.status, e.year_id
from profiles p
left join enrollments e on e.student_id = p.id and e.status = 'active'
where p.email like 'staging-%';
