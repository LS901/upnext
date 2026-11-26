-- Seed data for local development, applied by `npx supabase db reset` after migrations.
-- Invented data only: never real users, emails or libraries.

insert into public.items (media_type, provider, provider_id, title) values
  ('movie', 'tmdb', '900001', 'Lanterns Over Kesh'),
  ('movie', 'tmdb', '900002', 'The Quiet Orchard'),
  ('game', 'igdb', '800001', 'Tidewright'),
  ('show', 'tmdb', '700001', 'Harbour Lights');

insert into public.seasons (show_id, season_number, title)
select id, n, 'Season ' || n
from public.items, generate_series(1, 3) as n
where title = 'Harbour Lights';
