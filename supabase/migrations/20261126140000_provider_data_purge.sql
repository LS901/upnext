-- TMDB allows caching its data for at most 6 months (INV-007). When an item
-- hasn't refreshed successfully for 150 days, the refresh job nulls its
-- provider fields (keeping the title and season numbers) and stamps
-- provider_data_purged_at. A later successful refresh restores the fields and
-- clears it.
--
-- refresh_attempted_at records every refresh attempt, failed or not, so an
-- item that keeps failing upstream goes to the back of the refresh queue
-- instead of blocking it. refreshed_at still records only successes.
alter table public.items
  add column provider_data_purged_at timestamptz,
  add column refresh_attempted_at timestamptz;
