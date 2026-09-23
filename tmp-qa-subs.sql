select p.email, s.status, s.paid_access_mode, s.starts_at, s.ends_at, s.year_id, y.name as year_name
from profiles p
left join subscriptions s on s.student_id = p.id
left join years y on y.id = s.year_id
where p.email in ('staging-paid@medverse.local','staging-student@medverse.local');
