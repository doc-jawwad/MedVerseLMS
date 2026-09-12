-- 0003: curriculum hierarchy (docs/database.md)
-- years -> subjects -> books -> chapters -> topics
-- chapters/topics carry denormalized subject_id/year_id (trigger-maintained) so RLS stays join-free.

create table public.years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  year_number int not null unique check (year_number between 1 and 5),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  year_id uuid not null references public.years (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year_id, name)
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  year_id uuid not null references public.years (id),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, name)
);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  book_id uuid not null references public.books (id) on delete cascade,
  subject_id uuid not null references public.subjects (id),
  year_id uuid not null references public.years (id),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, name)
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  book_id uuid not null references public.books (id),
  subject_id uuid not null references public.subjects (id),
  year_id uuid not null references public.years (id),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, name)
);

create index subjects_year_idx on public.subjects (year_id);
create index books_subject_idx on public.books (subject_id);
create index chapters_book_idx on public.chapters (book_id);
create index chapters_subject_idx on public.chapters (subject_id);
create index topics_chapter_idx on public.topics (chapter_id);
create index topics_subject_idx on public.topics (subject_id);

create trigger years_updated_at before update on public.years for each row execute function public.set_updated_at();
create trigger subjects_updated_at before update on public.subjects for each row execute function public.set_updated_at();
create trigger books_updated_at before update on public.books for each row execute function public.set_updated_at();
create trigger chapters_updated_at before update on public.chapters for each row execute function public.set_updated_at();
create trigger topics_updated_at before update on public.topics for each row execute function public.set_updated_at();

-- keep denormalized ancestor ids correct
create or replace function public.sync_book_ancestors()
returns trigger language plpgsql as $$
begin
  select s.year_id into new.year_id from public.subjects s where s.id = new.subject_id;
  return new;
end; $$;

create or replace function public.sync_chapter_ancestors()
returns trigger language plpgsql as $$
begin
  select b.subject_id, b.year_id into new.subject_id, new.year_id
  from public.books b where b.id = new.book_id;
  return new;
end; $$;

create or replace function public.sync_topic_ancestors()
returns trigger language plpgsql as $$
begin
  select c.book_id, c.subject_id, c.year_id into new.book_id, new.subject_id, new.year_id
  from public.chapters c where c.id = new.chapter_id;
  return new;
end; $$;

create trigger books_sync_ancestors before insert or update of subject_id on public.books
  for each row execute function public.sync_book_ancestors();
create trigger chapters_sync_ancestors before insert or update of book_id on public.chapters
  for each row execute function public.sync_chapter_ancestors();
create trigger topics_sync_ancestors before insert or update of chapter_id on public.topics
  for each row execute function public.sync_topic_ancestors();

-- RLS: admin ALL now; student SELECT policies are added in 0004 (they need enrollments).
alter table public.years enable row level security;
alter table public.subjects enable row level security;
alter table public.books enable row level security;
alter table public.chapters enable row level security;
alter table public.topics enable row level security;

create policy years_admin_all on public.years for all using (public.is_admin()) with check (public.is_admin());
create policy subjects_admin_all on public.subjects for all using (public.is_admin()) with check (public.is_admin());
create policy books_admin_all on public.books for all using (public.is_admin()) with check (public.is_admin());
create policy chapters_admin_all on public.chapters for all using (public.is_admin()) with check (public.is_admin());
create policy topics_admin_all on public.topics for all using (public.is_admin()) with check (public.is_admin());
