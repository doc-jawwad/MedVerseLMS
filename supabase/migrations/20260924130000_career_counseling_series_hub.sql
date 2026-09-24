-- Career Counseling Series hub: independent library_type (not Other Services).
-- Docs: architecture.md §2b-iv, database.md material_folders.

alter table public.material_folders
  drop constraint if exists material_folders_library_type_check;

alter table public.material_folders
  add constraint material_folders_library_type_check
  check (library_type in (
    'guidelines',
    'los',
    'ospe_material',
    'ospe_lectures',
    'ospe_past',
    'books',
    'notes',
    'lectures',
    'syllabus',
    'schedule',
    'past_papers',
    'flashcards',
    'other_services',
    'career_counseling_series'
  ));

comment on column public.material_folders.library_type is
  'Folder category. past_papers / other_services / career_counseling_series are top-level shell hubs (not Block chrome).';
