-- The version is set exactly on book entries. The first form of this check,
-- (item_media_type = 'book') = (book_version is not null), is NULL for a season
-- entry (its item_media_type is null), and a NULL check passes, so a season entry
-- could carry a book_version. coalesce makes a season entry count as "not a book".
alter table public.library_entries
  drop constraint library_entries_book_version_check,
  add constraint library_entries_book_version_check
    check (coalesce(item_media_type = 'book', false) = (book_version is not null));
