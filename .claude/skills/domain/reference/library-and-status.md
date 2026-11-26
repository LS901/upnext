Last reviewed: 2026-11-26

Sources: owner interview and follow-up, 2026-11-26 (Lewis). The app is scaffolded but has no library code yet, so nothing here is checked against an implementation.

# Library and status

Terms are defined in `glossary.md`. Examples are invented.

## What a library entry holds

- The item it is about (one item, one media type). A user has **at most one entry per item**: no duplicates (owner said, 2026-11-26; INV-008).
- For **movies and games**: one **status** for the item: Backlog, In progress, Finished, Paused or Dropped. No progress below the item (owner said). A game's progress is its status.
- For **shows**: a status **per season**, from the same five. Never per-episode progress. Finishing a season marks only that season Finished, so finishing the last season does not finish anything else (owner said, 2026-11-26).
- A **play count**: rewatches and replays add to it on the same entry (owner said, 2026-11-26).
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

**Up next** is an ordered shortlist inside Backlog, not a sixth status (owner said, 2026-11-26). The user orders it.

## Unconfirmed

- **Leaving up next**: probably an item drops off the shortlist when it moves to In progress. Owner to confirm.
- **Transitions**: probably any status can move to any other. Is there anything that should be blocked, for example Backlog straight to Finished? Owner to confirm.
- **Show-level status**: seasons carry their own status (confirmed). Does the show also have one, for example derived ("2 of 4 seasons finished"), or only its seasons? Owner to confirm.
- **New seasons**: when a new season airs, does it start as Backlog on the user's entry, or untracked until the user adds it? Owner to confirm.
- **Up next for shows**: is up next a list of shows, or can a single season be up next? Owner to confirm.
- **Play count for shows**: does a rewatch count per season or for the whole show? Owner to confirm.
- **Dates**: which dates are kept (added, started, finished), and whether they can be edited. Owner to confirm.
