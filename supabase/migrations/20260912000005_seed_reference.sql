-- Seed: MBBS years + starter subjects (idempotent)
insert into public.years (year_number, name) values
  (1, '1st Year MBBS'),
  (2, '2nd Year MBBS'),
  (3, '3rd Year MBBS'),
  (4, '4th Year MBBS'),
  (5, '5th Year MBBS')
on conflict (year_number) do nothing;

insert into public.subjects (year_id, name, sort_order)
select y.id, s.name, s.ord
from public.years y
join (values
  (1, 'Anatomy', 1), (1, 'Physiology', 2), (1, 'Biochemistry', 3),
  (2, 'Anatomy', 1), (2, 'Physiology', 2), (2, 'Biochemistry', 3),
  (3, 'Pathology', 1), (3, 'Pharmacology', 2), (3, 'Forensic Medicine', 3), (3, 'Community Medicine', 4),
  (4, 'General Medicine', 1), (4, 'General Surgery', 2), (4, 'ENT', 3), (4, 'Ophthalmology', 4),
  (5, 'Medicine', 1), (5, 'Surgery', 2), (5, 'Gynae & Obs', 3), (5, 'Paediatrics', 4)
) as s(year_number, name, ord) on s.year_number = y.year_number
on conflict (year_id, name) do nothing;

-- Dev admin: sign up normally as admin@medverse.local, then run:
--   update public.profiles set role='admin' where email='admin@medverse.local';
