-- Books: series, per-entry versions (print or audio), book metadata on items and
-- per-user book exclusions. The enum values are added in the previous migration.

create type public.book_version as enum ('print', 'audio');

create table public.book_series (
  id uuid primary key default gen_random_uuid(),
  provider public.provider not null,
  provider_id text not null,
  name text not null,
  primary_books_count int,
  is_completed boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id)
);

create trigger book_series_set_updated_at
  before update on public.book_series
  for each row execute function public.set_updated_at();

-- Like items: readable by everyone, written only by the service role.
alter table public.book_series enable row level security;

create policy "book series are readable by everyone"
  on public.book_series for select
  to anon, authenticated
  using (true);

alter table public.items
  add column page_count int,
  add column audio_minutes int,
  add column has_audiobook boolean,
  add column narrators text,
  add column series_id uuid references public.book_series (id) on delete set null,
  add column series_position numeric,
  add column series_position_label text;

create index items_series_id_idx on public.items (series_id);

alter table public.library_entries
  add column book_version public.book_version;

-- The check and unique constraints were created unnamed; these are their generated names.
alter table public.library_entries
  drop constraint library_entries_item_media_type_check,
  drop constraint library_entries_user_id_item_id_key;

-- INV-008: one entry per item per version (a print and an audio entry may coexist).
-- Nulls are not distinct so a movie or game (version null) still gets one entry. It is
-- a partial index because season entries have a null item_id and must stay unlimited.
create unique index library_entries_user_item_version_key
  on public.library_entries (user_id, item_id, book_version) nulls not distinct
  where item_id is not null;

alter table public.library_entries
  add constraint library_entries_item_media_type_check
    check (item_media_type in ('movie', 'game', 'book')),
  -- the version is set exactly on book entries
  add constraint library_entries_book_version_check
    check ((item_media_type = 'book') = (book_version is not null));

-- Books a user leaves out of a series' progress count, the book version of
-- progress_exclusions.
create table public.book_exclusions (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  -- INV-003: removing a catalogue row must never silently delete user data
  item_id uuid not null references public.items (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.book_exclusions enable row level security;

create policy "exclusions are readable by owner or when library is public"
  on public.book_exclusions for select
  to anon, authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = book_exclusions.user_id and not p.library_private
    )
  );

create policy "owner inserts own book exclusions"
  on public.book_exclusions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner updates own book exclusions"
  on public.book_exclusions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner deletes own book exclusions"
  on public.book_exclusions for delete
  to authenticated
  using (user_id = (select auth.uid()));
