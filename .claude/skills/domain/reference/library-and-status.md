Last reviewed: 2026-11-26

Sources: owner interview and follow-up, 2026-11-26 (Lewis); owner decisions on show progress and books, 2026-11-26; schema in `supabase/migrations/20261126082919_library_entries.sql` and `20261126083314_notes_and_exclusions.sql`. The data model and its row-level security exist; there are no library pages or handlers yet.

# Library and status

Terms are defined in `glossary.md`. Examples are invented.

## What a library entry holds

- The item it is about (one item, one media type). A user has **at most one entry per item**: no duplicates (owner said, 2026-11-26; INV-008).
- For **movies and games**: one **status** for the item: Backlog, In progress, Finished, Paused or Dropped. No progress below the item (owner said). A game's progress is its status.
- For **shows**: a status **per season**, from the same five. Never per-episode progress. Finishing a season marks only that season Finished, so finishing the last season does not finish anything else (owner said, 2026-11-26). A season is its own entity with its own entry; an entry points at a movie, a game or a season, never at a show (`library_entries` in the migration).
- A **play count**: rewatches and replays add to it on the same entry (owner said, 2026-11-26). For shows it is **per season**: a rewatch adds to that season's play count (owner said, 2026-11-26).
- For **books** (planned, see below): tracked like movies. One status for the item, and the play count counts rereads (owner said, 2026-11-26).
- The user's own fields: status, play count, notes, dates. These belong to the user and must survive any metadata refresh (see `invariants.md`).
- **No user ratings.** upnext shows the providers' review scores as item info instead (owner said, 2026-11-26; see `metadata.md`).

## Statuses

| Status | Meaning |
|---|---|
| Backlog | Want to, not started |
| In progress | Watching or playing now |
| Finished | Completed |
| Paused | On hold, intending to return |
| Dropped | Abandoned, kept for the record |

**Up next** is an ordered shortlist inside Backlog, not a sixth status (owner said, 2026-11-26). The user orders it. It holds items and single seasons: one season of a show can be up next, and someone can track only season 5 of a show, for example an anthology (owner said, 2026-11-26). In the database it is `up_next_position`, allowed only while the status is Backlog.

## Shows have no status of their own

A show has **no status of its own**. Its seasons carry the statuses, and a **progress summary** such as "2 of 4 seasons finished" is derived from them (owner said, 2026-11-26):

- Every season of the show counts by default.
- The user can **exclude** specific seasons from the count, for example the seasons of an anthology they don't plan to watch. Excluding a season never changes its entry, and a user can exclude a season they never added (`progress_exclusions`).
- Denominator: the show's seasons minus the user's exclusions. Numerator: the user's Finished season entries that aren't excluded.
- A **newly aired season is untracked** until the user adds it; it doesn't appear as Backlog on its own (owner said, 2026-11-26).

The summary is computed in the library pages task; today only the exclusions are stored.

## Books (planned)

Books become a **fourth media type**, planned for after the TMDB and IGDB import (owner said, 2026-11-26). The database has no `book` value yet; adding it is a later migration, together with the book provider.

- A book is tracked like a movie: one status for the item, and a play count for rereads.
- A **book series works like a show**: each book is its own entity with its own status, and a series progress such as "3 of 7 read" is derived, with the same exclusions (owner said, 2026-11-26).
- An **audiobook is a separate item from its book**, with its own entry, status and play count (owner said, 2026-11-26).
- The provider is proposed in `metadata.md` (Open Library, unconfirmed).

## Unconfirmed

- **Leaving up next**: probably an item drops off the shortlist when it moves to In progress. Owner to confirm.
- **Transitions**: probably any status can move to any other. Is there anything that should be blocked, for example Backlog straight to Finished? Owner to confirm.
- **Audiobooks**: whether an audiobook is its own media type or a format of book, and where audiobook data comes from. Left to the books task.
- **Dates**: which dates are kept (added, started, finished), and whether they can be edited. Owner to confirm.
