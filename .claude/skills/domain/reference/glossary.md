Last reviewed: 2026-11-26

Sources: owner interview, 2026-11-26 (Lewis); API research, 2026-11-26 (TMDB API terms and FAQ, IGDB API docs, community reports linked in `metadata.md`); owner follow-up, 2026-11-26 (no user ratings, a status per season, one entry per item with a play count, private lists). The app is scaffolded but has no library code yet.

# Glossary

Paths below are relative to the named repo. Examples are invented.

| Term | Meaning | Source |
|---|---|---|
| **Media type** | One of `movie`, `show` (TV) or `game`. Every item has exactly one. | owner said (2026-11-26) |
| **Item** | A movie, show or game in the shared catalogue, described by metadata from a provider (see `metadata.md`). It belongs to no user. | owner said (2026-11-26) |
| **Library** | One user's collection of library entries. | owner said (2026-11-26) |
| **Library entry** | A user's own record of one item: status (per season for shows), play count, notes and dates. A user has at most one entry per item. The user owns this data, not the provider. | owner said (2026-11-26) |
| **Play count** | How many times the user has finished an item. A rewatch or replay adds to it on the same entry; it never creates a second entry. | owner said (2026-11-26) |
| **Status** | Where a library entry is: Backlog, In progress, Finished, Paused or Dropped (see `library-and-status.md`). | owner said (2026-11-26) |
| **Backlog** | Items the user wants to watch or play and hasn't started. | owner said (2026-11-26) |
| **In progress** | Currently watching or playing. | owner said (2026-11-26) |
| **Finished** | Completed. | owner said (2026-11-26) |
| **Paused** | Started, then put on hold, with the intent to return. | owner said (2026-11-26) |
| **Dropped** | Started, then abandoned. Kept for the record, not deleted. | owner said (2026-11-26) |
| **Season progress** | For shows, each season has its own status (Backlog, In progress, Finished, Paused or Dropped). Never tracked per episode. Finishing a season marks only that season Finished. | owner said (2026-11-26) |
| **Time to finish** | How long an item takes. Movie: its runtime. Show: the sum of episode runtimes, per season and in total. Game: its time to beat. | owner said (2026-11-26) |
| **Time to beat** | A game's estimated play time from IGDB `game_time_to_beats`: `hastily` (main story), `normally` (story plus some side content) and `completely` (100%), each an average in seconds, with `count` submissions behind it. | research: IGDB API docs (2026-11-26) |
| **Metadata provider** | The outside source of item data: TMDB for movies and shows, IGDB for games. | research (2026-11-26); not yet confirmed by owner |
| **Up next** | An ordered shortlist inside the Backlog: what the user plans to start soonest. It is not a separate status. | owner said (2026-11-26) |
| **Public library** | The default. Other users, and signed-out visitors, can read a user's library (read-only), but never its notes. | owner said (2026-11-26) |
| **Private library** | A library its owner opted out of sharing. Nobody else sees it. | owner said (2026-11-26) |
| **Notes** | A user's free-text notes on a library entry. Always private to the owner. | owner said (2026-11-26) |
| **Public profile** | A user's page others can view, showing their library unless it is private. | owner said (2026-11-26) |
| **List** | A user-made collection of items, for example "Cosy winter games". Public by default; the owner can make a single list private. | owner said (2026-11-26) |
| **Review score** | A provider's aggregate score for an item (TMDB vote average, IGDB rating), shown as item info with how many votes it rests on. upnext has no user ratings of its own. | owner said (2026-11-26); fields in `metadata.md` |
| **Spoiler** | Season synopses, episode titles or stills for seasons after the user's current season progress. Hidden unless the user opts in. | owner confirmed INV-004 (2026-11-26) |

## Unconfirmed

Guesses that need the owner's word before anyone relies on them.

| Term | Guessed meaning | Source |
|---|---|---|
| **Show status** | Whether a show has an overall status of its own, or only its seasons do (perhaps with a summary derived from them). | guess |
