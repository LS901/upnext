---
name: domain
description: Domain reference for upnext, a backlog and tracker for movies, TV shows and games - library entries and statuses (backlog, up next, in progress, finished, paused, dropped), season progress for TV, time to finish and time to beat, metadata from TMDB and IGDB, public profiles and lists, spoilers, and the invariants that must never be broken. Load it for domain questions, designs, tickets and reviews, and for any change that touches a user's library, visibility, metadata imports, secrets or personal data.
---

# domain

What the domain means, and what must never happen. This skill points to the reference files; read the one you need rather than relying on memory.

<!--
Add one reference file per domain area and a row for it below.
The team-workflow session-start check requires every file in reference/ to be linked
from this table.
-->

## Which file to read

| Topic | File |
|---|---|
| What a term means | `reference/glossary.md` |
| Media types, statuses (per season for TV), up next, play counts and dates | `reference/library-and-status.md` |
| Where item data comes from (TMDB, IGDB), time to finish/beat, review scores, refreshes, attribution | `reference/metadata.md` |
| Public profiles and lists, what is visible to whom, spoilers | `reference/sharing-and-spoilers.md` |
| What must never happen (anti-goals, review checks, test ideas) | `reference/invariants.md` |

## How to use it

- **Cite the reference file you used**, for example "per `domain/reference/glossary.md`". Each fact in those files cites its own source (repo, file and line, or "owner said").
- **Anything under an "Unconfirmed" heading is a guess**, not a rule. Say so when you rely on it, and ask the developer if it matters.
- **For anti-goals** (agreement section 2), list the invariants your change could break and say how you'll check each one.
- **Code versus invariant:** the code is the truth about what happens today; the invariants are the truth about what must happen. When they differ, the gap is a bug to report, not something to paper over or copy into new code.
- **Technical detail** (tables, handlers, caching, UI components) lives in the project's `tech-reference` skill, not here.
- **Stale or wrong?** If the code or the developer contradicts a reference file, say so and route the fix with `team-workflow:retro`. Don't silently work around it.
- **Never put real customer or staff data** (names, addresses, phone numbers, credentials, location data) in examples. Invent them.

## Adding a reference file

Every file in `reference/` must:

- start with `Last reviewed: YYYY-MM-DD` on line 1,
- have a `Sources:` line naming where its facts came from,
- be linked from the table above.
