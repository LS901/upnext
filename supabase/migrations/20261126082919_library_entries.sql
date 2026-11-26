-- Library entries: a user's record of one movie, game or single season.
-- Shows are tracked season by season, never directly.
create type public.entry_status as enum (
  'backlog', 'in_progress', 'finished', 'paused', 'dropped'
);

-- Reusable before-update trigger function that keeps updated_at current.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  item_id uuid,
  item_media_type public.media_type
    check (item_media_type in ('movie', 'game')),
  season_id uuid,
  status public.entry_status not null default 'backlog',
  play_count int not null default 0 check (play_count >= 0),
  -- up next is a shortlist inside Backlog; a float so a reorder can insert
  -- between two positions
  up_next_position double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- INV-003: removing a catalogue row must never silently delete user data
  foreign key (item_id, item_media_type)
    references public.items (id, media_type) on delete restrict,
  foreign key (season_id) references public.seasons (id) on delete restrict,
  check (num_nonnulls(item_id, season_id) = 1),
  check ((item_id is null) = (item_media_type is null)),
  check (up_next_position is null or status = 'backlog'),
  -- INV-008: no duplicate entries (nulls don't collide, so each covers its kind)
  unique (user_id, item_id),
  unique (user_id, season_id),
  -- target for the notes foreign key
  unique (id, user_id)
);

create index library_entries_user_id_idx on public.library_entries (user_id);

create trigger library_entries_set_updated_at
  before update on public.library_entries
  for each row execute function public.set_updated_at();

alter table public.library_entries enable row level security;

-- INV-001 / INV-002: owner always; anyone when the owner's library is public
create policy "entries are readable by owner or when library is public"
  on public.library_entries for select
  to anon, authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = library_entries.user_id and not p.library_private
    )
  );

create policy "owner inserts own entries"
  on public.library_entries for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner updates own entries"
  on public.library_entries for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner deletes own entries"
  on public.library_entries for delete
  to authenticated
  using (user_id = (select auth.uid()));
