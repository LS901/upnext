-- TMDB allows caching its data for at most 6 months (INV-007). When an item
-- hasn't refreshed successfully for 150 days, the refresh job nulls its
-- provider fields (keeping the title and season numbers) and stamps this
-- column. A later successful refresh restores the fields and clears it.
alter table public.items
  add column provider_data_purged_at timestamptz;
