-- Provider metadata for catalogue items and seasons. Unknown values are null,
-- never 0. Still written only by the service role.
alter table public.items
  add column image_ref text,                    -- TMDB poster_path or IGDB cover image_id
  add column release_date date,
  add column runtime_minutes int,               -- movies
  add column score numeric(5,2)                 -- 0-100, normalised
    check (score between 0 and 100),
  add column score_count int,
  add column ttb_hastily_s int,                 -- games, seconds
  add column ttb_normally_s int,
  add column ttb_completely_s int,
  add column ttb_count int,
  add column refreshed_at timestamptz not null default now();

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

alter table public.seasons
  add column episode_count int,
  add column runtime_minutes int,               -- sum of episode runtimes, null when unknown
  add column air_date date,
  add column updated_at timestamptz not null default now();

create trigger seasons_set_updated_at
  before update on public.seasons
  for each row execute function public.set_updated_at();

-- Counting a user's exclusions per season (library progress).
create index progress_exclusions_season_id_idx
  on public.progress_exclusions (season_id);
