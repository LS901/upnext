Last reviewed: 2026-11-26

Sources: owner interview, 2026-11-26 (Lewis). No code yet: the `upnext` repo is not scaffolded, so nothing here is checked against an implementation.

# Library and status

Terms are defined in `glossary.md`. Examples are invented.

## What a library entry holds

- The item it is about (one item, one media type).
- A **status**: Backlog, In progress, Finished, Paused or Dropped.
- For **shows**: season progress, meaning which seasons are watched, in progress or not started. Never per-episode progress (owner said).
- For **movies and games**: no progress below the item (owner said). A game's progress is its status.
- The user's own fields: rating, notes, dates. These belong to the user and must survive any metadata refresh (see `invariants.md`).

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
- **Show status from season progress**: does finishing the last aired season set the show to Finished? And when a new season airs, does a Finished show go back to In progress? Owner to confirm.
- **Replays and rewatches**: extra plays on one entry, or a new entry? Owner to confirm.
- **Dates**: which dates are kept (added, started, finished), and whether they can be edited. Owner to confirm.
