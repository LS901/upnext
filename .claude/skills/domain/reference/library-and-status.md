Last reviewed: 2026-11-27

Sources: owner interview and follow-up, 2026-11-26 (Lewis); owner decisions on show progress and books, 2026-11-26; owner on audiobooks (a version under books, picked with a selector), 2026-11-26; schema in `supabase/migrations/20261126082919_library_entries.sql`, `20261126083314_notes_and_exclusions.sql` and `20261126200000_up_next_order.sql` and `20261127090000_finished_at.sql`. The data model and its row-level security exist, and the My library page (`src/app/library/`, `src/lib/library/`) shows status and show progress; there are no lists or public profile pages yet.

# Library and status

Terms are defined in `glossary.md`. Examples are invented.

## What a library entry holds

- The item it is about (one item, one media type). A user has **at most one entry per item**: no duplicates (owner said, 2026-11-26; INV-008).
- For **movies and games**: one **status** for the item: Up next, In progress, Finished, Paused or Dropped. No progress below the item (owner said). A game's progress is its status.
- For **shows**: a status **per season**, from the same five. Never per-episode progress. Finishing a season marks only that season Finished, so finishing the last season does not finish anything else (owner said, 2026-11-26). A season is its own entity with its own entry; an entry points at a movie, a game or a season, never at a show (`library_entries` in the migration).
- A **play count**: rewatches and replays add to it on the same entry (owner said, 2026-11-26). For shows it is **per season**: a rewatch adds to that season's play count (owner said, 2026-11-26).
- For **books** (planned, see below): tracked like movies. One status for the item, and the play count counts rereads (owner said, 2026-11-26).
- The user's own fields: status, play count, notes, dates. These belong to the user and must survive any metadata refresh (see `invariants.md`).
- **No user ratings.** upnext shows the providers' review scores as item info instead (owner said, 2026-11-26; see `metadata.md`).

## Statuses

| Status | Meaning |
|---|---|
| Up next (stored as `backlog`) | Want to, not started |
| In progress | Watching or playing now |
| Finished | Completed |
| Paused | On hold, intending to return |
| Dropped | Abandoned, kept for the record |

**Up next** is the first status and the ordered queue of everything not started: there is no separate Backlog list and no shortlist inside it (owner said, 2026-11-27, merging the two). The enum value stays `backlog`. The user orders it. There is **one queue per media type**: Movies, TV (single seasons) and Games, and Books when books land. Each queue is ordered on its own, and an entry never moves into another type's queue (owner said, 2026-11-26). It holds items and single seasons: one season of a show can be up next, and someone can track only season 5 of a show, for example an anthology (owner said, 2026-11-26). In the database it is `up_next_position`, set exactly while the status is `backlog` (a check), and given by the `library_entries_queue_backlog` trigger, so the app never sets it on add.

## Up next

Owner said, 2026-11-26, except where marked as a ruling.

- **Leaving Up next**: an entry drops off its queue when it moves to any status other than Up next. The trigger clears `up_next_position`, which the schema check also requires. No old position is stored.
- **Adding and putting back**: a new entry, and an entry moved back to Up next from Paused, Dropped or any other status, goes to the bottom of its type's queue (the trigger does this).
- **Reordering is free**: the user can move any Up next entry to any position in its queue, at any time, as often as they like; nothing is fixed in place.
- **The Up next screen** sits at the top of My library:
  - Every Up next entry is in it; there is no Add to Up next. Each row has a status select, **Start**, which moves it to In progress and so off the queue, and **Remove**, which deletes the entry from the library.
  - A queue is reordered with **Move up**, **Move down** and **Move to top** buttons, and by **drag and drop**. A queued TV season is titled with its show and season, such as "Example Show · Season 2" (ruling, 2026-11-27, from review; owner may overrule).
  - A **Show** row of checkboxes displays or hides each type's queue. The choice is remembered on that device. Each checkbox shows its queue's count, so a hidden queue still says what's in it (ruling, 2026-11-27, from review; owner may overrule).
  - There is no Backlog group: not-started entries show only in their queue. Hiding a queue hides those entries from My library.

## Home dashboard

Owner said, 2026-11-27.

- Signed in, Home is a **view of the user's own library** and nothing else: their numbers (entries per status and the Up next time to finish), what they're on, their Up next queues, a release radar and what they recently finished. It never shows another user's entries. Signed out, Home is a landing page that points to Sign in.
- **Release radar:** Up next entries only, whose movie or game release date, or season air date, is after today (in UTC), soonest first, at most 8. Entries with no date are left out. IGDB dates for unreleased games can be placeholders, and are shown as given.
- **Recently finished** lists Finished entries, newest `finished_at` first.
- A queue the user hides in My library is hidden on Home too.

## Shows have no status of their own

A show has **no status of its own**. Its seasons carry the statuses, and a **progress summary** such as "2 of 4 seasons finished" is derived from them (owner said, 2026-11-26):

- Every season of the show counts by default.
- The user can **exclude** specific seasons from the count, for example the seasons of an anthology they don't plan to watch. Excluding a season never changes its entry, and a user can exclude a season they never added (`progress_exclusions`).
- Denominator: the show's seasons minus the user's exclusions. Numerator: the user's Finished season entries that aren't excluded.
- A **newly aired season is untracked** until the user adds it; it doesn't appear in Up next on its own (owner said, 2026-11-26).

The summary is computed by `showProgress` (`src/lib/library/progress.ts`) and shown on My library. **Specials (TMDB season 0) are left out of the count** (ruling, owner may overrule): only seasons numbered 1 or more count. There is no UI to set exclusions yet; the maths honours them.

## Books (planned)

Books become a **fourth media type**, planned for after the TMDB and IGDB import (owner said, 2026-11-26). The database has no `book` value yet; adding it is a later migration, together with the book provider.

- A book is tracked like a movie: one status for the item, and a play count for rereads.
- A **book series works like a show**: each book is its own entity with its own status, and a series progress such as "3 of 7 read" is derived, with the same exclusions (owner said, 2026-11-26).
- **Audiobooks live under books**, not as a media type of their own. When a user adds a book, a selector lets them pick the audiobook version, and that version is tracked as its own entry, with its own status and play count (owner said, 2026-11-26).
- The provider is proposed in `metadata.md` (still unconfirmed; the books task starts by comparing free sources).

## Unconfirmed

- **Transitions**: probably any status can move to any other. Is there anything that should be blocked, for example Up next straight to Finished? Owner to confirm.
- **Print and audiobook of one book**: whether one user can track both versions of the same book at once, and how that squares with one entry per item (INV-008). Left to the books task.
- **Audiobook data**: where audiobook editions, narrators and lengths come from. Left to the books task.
- **Dates**: a finish time is kept as `finished_at`, set when an entry moves into Finished and cleared when it leaves, so finishing again after a rewatch stamps a newer time (owner said, 2026-11-27). Whether added and started times are kept, and whether any date can be edited, is still open. Owner to confirm.
