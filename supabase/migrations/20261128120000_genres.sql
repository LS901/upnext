-- Genres and genre pins, for the recommendation rows under an empty search box.
--
-- items.genres holds the provider's genre names (TMDB, IGDB, Hardcover). It is
-- catalogue data like the rest of items: written only by the import (and so the
-- refresh), and cleared by the purge.
alter table public.items
  add column genres text[] not null default '{}';

-- The genres a user pins on /settings, shown first among their recommendation
-- rows. Private to the user: nobody else, signed in or not, reads them (INV-002),
-- even while their library is public. Their order is the order they were pinned.
create table public.user_genre_pins (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  -- Other has no provider, so nothing to recommend from
  media_type public.media_type not null check (media_type <> 'other'),
  genre text not null check (char_length(genre) between 1 and 60),
  created_at timestamptz not null default now(),
  primary key (user_id, media_type, genre)
);

alter table public.user_genre_pins enable row level security;

create policy "owner reads own genre pins"
  on public.user_genre_pins for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The primary key starts with user_id, so a duplicate can only be the caller's
-- own row: its error says nothing about anyone else's pins.
create policy "owner inserts own genre pins"
  on public.user_genre_pins for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner deletes own genre pins"
  on public.user_genre_pins for delete
  to authenticated
  using (user_id = (select auth.uid()));
