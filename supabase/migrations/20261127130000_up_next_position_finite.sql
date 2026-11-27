-- An Up next place must be a finite number. A NaN or infinite place, which a user
-- could write to their own entry through the API, would poison max() and so every
-- later add to that queue. Postgres sorts NaN above Infinity, so these two bounds
-- refuse all three; a null place (an entry not in Backlog) passes, as checks do.
alter table public.library_entries
  add constraint library_entries_up_next_position_finite
    check (up_next_position > '-Infinity' and up_next_position < 'Infinity');
