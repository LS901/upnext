-- Shared catalogue: items (movies, shows, games) and seasons of shows.
-- Owned by nobody. Readable by everyone; written only by the service role
-- (no insert/update/delete policies exist for anon or authenticated).
create type public.media_type as enum ('movie', 'show', 'game');
create type public.provider as enum ('tmdb', 'igdb');

create table public.items (
  id uuid primary key default gen_random_uuid(),
  media_type public.media_type not null,
  provider public.provider not null,
  provider_id text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- TMDB movie and TV ids are separate namespaces
  unique (provider, media_type, provider_id),
  -- target for composite foreign keys (seasons, library entries)
  unique (id, media_type)
);

alter table public.items enable row level security;

create policy "items are readable by everyone"
  on public.items for select
  to anon, authenticated
  using (true);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null,
  show_media_type public.media_type not null default 'show'
    check (show_media_type = 'show'),
  season_number int not null check (season_number >= 0), -- 0 = specials (TMDB)
  title text,
  -- a season can only belong to a show
  foreign key (show_id, show_media_type)
    references public.items (id, media_type) on delete cascade,
  unique (show_id, season_number)
);

alter table public.seasons enable row level security;

create policy "seasons are readable by everyone"
  on public.seasons for select
  to anon, authenticated
  using (true);
