-- Past Papers / Other Services hubs: extend library_type + optional folder description.
-- Reuses material_folders.parent_id nesting for Past Papers Sub → Sub-Sub → PDF.
-- Docs: architecture.md §2b-ii / §2b-iii, database.md material_folders.

alter table public.material_folders
  add column if not exists description text;

comment on column public.material_folders.description is
  'Optional blurb for Other Services (and reusable elsewhere). Not PDF body text.';

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
    'other_services'
  ));

comment on column public.material_folders.library_type is
  'Folder category. past_papers / other_services are top-level shell hubs (not Block chrome).';
