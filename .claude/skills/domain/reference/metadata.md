Last reviewed: 2026-11-27

Sources: owner interview, 2026-11-26 (Lewis); API research, 2026-11-26: TMDB API Terms of Use (themoviedb.org/api-terms-of-use) and FAQ (developer.themoviedb.org/docs/faq); IGDB API docs (api-docs.igdb.com) and partnership page (igdb.com/api); Letterboxd API page (letterboxd.com/api-beta); community reports on HowLongToBeat wrappers; owner follow-up, 2026-11-26 (review scores); owner on books, 2026-11-26; Open Library proposal from research, not yet checked against its docs; owner on the book provider (Open Library if it is the best free source, after a comparison), 2026-11-26; owner set up the TMDB and IGDB credentials, 2026-11-26; provider clients, import and refresh built, 2026-11-26 (`src/lib/providers/`, `src/lib/catalogue/`); the branch's final review, 2026-11-26 (Before public signups); books source comparison, 2026-11-27 (Hardcover, Open Library and Google Books docs and terms); Hardcover client built, 2026-11-27 (`src/lib/providers/hardcover.ts`).

# Metadata: where item data comes from

The owner asked for useful item info when items are pulled in: time to finish for movies and TV, and estimated story and 100% hours for games (owner said, 2026-11-26). TMDB, IGDB and Hardcover are the confirmed providers: the owner set up credentials for TMDB and IGDB (owner said, 2026-11-26), and Hardcover was chosen for books after a comparison (2026-11-27, see Books). The clients, the import and the refresh are built (`src/lib/providers/`, `src/lib/catalogue/`).

## Providers (confirmed)

| Media type | Provider | What we take | Why |
|---|---|---|---|
| Movie | TMDB | title, poster, release date, runtime (time to finish), genres, review score | The common choice for film and TV apps. Letterboxd points developers to TMDB for film data. |
| Show | TMDB | title, poster, seasons, episode runtimes (summed per season for time to finish), review score | Has season and episode detail, so a per-season time can be derived. |
| Game | IGDB (Twitch) | title, cover, platforms, release date, time to beat (`hastily`, `normally`, `completely`, `count`), review scores | The common game database. Its official `game_time_to_beats` endpoint gives story and 100% estimates. |
| Book | Hardcover (GraphQL) | title, cover, release date, page count, series and position, audiobook length and narrators, review score | The only free source with structured series and audiobook data, and its terms allow our use (see Books). |

## Books

Hardcover is the book provider (owner said, 2026-11-27, after the comparison below). The client is `src/lib/providers/hardcover.ts`; its rules are in the `tech-reference` skill. Series and audiobooks are described in `library-and-status.md`.

**Source comparison** (2026-11-27):

| | Hardcover | Open Library | Google Books |
|---|---|---|---|
| Series | Structured (position, featured flag, primary book count, completed) | None documented | None documented |
| Audiobooks | Structured (format, length, narrators) | Free-text format only | None |
| Ratings | Average and count; allowed if labelled as Hardcover's | Work-level, fields not documented | Average and count |
| Terms | Aggregate data allowed with a Hardcover label; no user-owned data on public sites; no copyright claimed over the data | Not meant as a backend for third-party services | Bans permanent copies, which conflicts with the catalogue import |
| Limits | Free plan: 5,000 a day, 60 a minute, app-wide for one token | 1 request a second | Not published |

Hardcover is the only source with structured series and audiobook data, and its terms allow our use. Open Library's terms rule it out as an app backend and it has no series or audio data. Google's terms conflict with storing a catalogue.

- **What we take:** title, cover, release date, page count, series and position, audiobook length and narrators, and the aggregate rating with its count. **We never read a book's `description`, nor any user-owned Hardcover field** (reviews, lists, users' libraries, individual ratings): the terms bar user-owned data on public sites (INV-004).
- **Covers:** the full cover URL is stored in `items.image_ref` and served from `assets.hardcover.app`. Covers are user-uploaded on Hardcover.
- **Time to finish:** a print book shows its page count (`320 pages`, `1 page`) and an audio entry its length (`audio_minutes`, rounded from seconds). Narrators read `Narrated by A, B`. A book with neither is unknown, never 0.
- **Rating label (mandatory):** Hardcover's terms allow aggregate ratings only when they are mentioned as Hardcover data, so a book's score always shows as `Hardcover rating 4.2/5 (1,234)`: the stored 0-100 score divided by 20 to one decimal, then the count. With no count it is `Hardcover rating 4.2/5`; with no score, `No score`.
- **Credit:** the Credits page carries `Book data from Hardcover`, linking to hardcover.app.
- **Limits:** one top-level GraphQL field per request, and requests at least 1 second apart. The client's limiter is in memory and server-wide, so every search waits its turn whenever Books isn't hidden. Hardcover's own limits are app-wide for one token.
- **Failure:** if Hardcover is down or slow, search still shows the TMDB and IGDB results, with `Couldn't reach Hardcover right now.`

**Launch items for Hardcover** (before any public launch; its API is beta):

- **A DMCA takedown policy:** Hardcover's covers are user-uploaded, so a public site needs one.
- **The commercial or public-good tier:** one token means app-wide limits of 5,000 a day and 60 a minute. That is fine while imports are cached in the catalogue and search is debounced, but a public launch needs the commercial plan (still "being built") or a public-good increase, asked for by email.
- **Token resets:** Hardcover "may reset tokens without notice". If book search starts failing everywhere, check the token first.

## Review scores

The owner wants review info pulled in from the providers, and upnext has no user ratings of its own (owner said, 2026-11-26). Each item stores **one normalised score from 0 to 100** (`items.score`, `numeric(5,2)`) with the number of votes behind it (`items.score_count`). The fields were checked against the provider code when the clients were built.

| Provider | Fields read | Normalised to |
|---|---|---|
| TMDB (movie, show) | `vote_average` (out of 10), `vote_count` | `vote_average × 10`, rounded to 2 decimals, with `vote_count` |
| IGDB (game) | `total_rating` (out of 100, users and critics together), `total_rating_count` | `total_rating` as it is, with `total_rating_count` |
| Hardcover (book) | `rating` (out of 5), `ratings_count` | `rating × 20`, rounded to 2 decimals, with `ratings_count` |

- A score with no votes, or out of range, is **null, never 0**. The library page shows "No score". When the score exists but its count doesn't, it shows the score alone, with no vote count (owner said, 2026-11-26).
- For games the combined `total_rating` is used, not the critics' `aggregated_rating` alone (ruling, owner may overrule). Confirm before the library UI hardens.
- Show the vote count beside the score (`src/lib/format/score.ts`). A book's score is always shown with the Hardcover label (see Books).

## Storage and limits

- **Cache limit:** TMDB content must not be cached longer than 6 months (INV-007). The refresh job re-imports items not refreshed for 7 days. Provider data not refreshed for **150 days** is purged: `items` keeps its title and each season keeps its number, and the poster, dates, runtimes, scores and time to beat are set to null (owner said, 2026-11-26). For books the purge also nulls `page_count`, `audio_minutes`, `narrators` and `has_audiobook`, and keeps the title and the series link (`series_id`, `series_position`, `series_position_label`) (ruling, 2026-11-27; owner may overrule). The next successful refresh restores them. The purge is keyed on `refreshed_at` (the last success), not on the last attempt.
- **Titles past 6 months:** the purge keeps the item title and season numbers (ruling, owner may overrule). **Open question for the owner:** check TMDB's terms on keeping titles past 6 months before any public launch.
- **Untracked items:** catalogue items nobody tracks are deleted 30 days after import (owner said, 2026-11-26), so the catalogue only holds what someone uses.
- **Logo and notice:** the TMDB logo and the Terms of Use notice ("This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.") appear on the Credits page (INV-007).
- **IGDB limits:** 4 requests per second and 8 open at once. The client starts at most 4 requests a second. It doesn't cap open requests, but one import has at most 2 in flight.
- **Null, not zero:** an unknown provider value is stored as null and shown as "unknown", never 0. This covers runtimes, scores, dates and time to beat.
- **Failed sub-requests:** a failed season request leaves only that season's runtime unknown, and a failed IGDB time-to-beat request leaves only the time to beat unknown. Neither fails the import, and a value already stored is kept (owner said, 2026-11-26).
- **Specials:** TMDB season 0 ("Specials") is imported and listed in the season picker as "Specials". It is left out of progress counts, which count seasons numbered 1 or more (ruling, owner may overrule).
- **Season picker:** it uses one summary TMDB request and stores nothing. Only the import writes the catalogue.
- **Provider failures** are logged server-side with the provider name and HTTP status only, never query text or user data (INV-006). A refresh logs a failed item by its catalogue id and the error's code or name only.
- **Provider storage under the Twitch agreement is still unconfirmed:** the Twitch Developer Service Agreement's terms on storing IGDB data have not been read.

## Before going commercial

A checklist, asked for by the owner (owner said, 2026-11-26). upnext is personal and non-commercial for now, and INV-007 links here.

- **TMDB:** its licence "does not permit any commercial use". A project counts as commercial if "the primary purpose is to create revenue for the benefit of the owner" (TMDB FAQ). Before any paid tier, ads or other monetisation, contact TMDB for a commercial agreement, which may cost money.
- **IGDB:** free only for non-commercial use under the Twitch Developer Service Agreement. Monetised use goes through an IGDB partnership (partner@igdb.com).
- **If access ever ends:** TMDB content must be purged, cached copies included.
- **Hardcover:** see the launch items under Books (a DMCA policy and the commercial or public-good tier).
- **Recheck every provider's current terms at that point.**

## Before public signups

Release checks for the day signups open to people other than the owner, from the branch's final review (final review, 2026-11-26).

- **Cap imports per user:** add a per-user import cap or rate limit before signups open. Any signed-in account can import items, and every imported item joins the global refresh queue, so one account could flood it and push everyone else's items past the 150-day purge (final review, 2026-11-26).
- **Confirm or undo Remove:** before any notes or play-count UI lands, Remove needs a confirmation or an undo. Deleting an entry cascades to its notes, so one stray click would lose them for good (INV-003) (final review, 2026-11-26).

## Rules of thumb

- **Provider data is not user data.** A refresh may update item fields. It must never touch a library entry's user fields (`invariants.md`).
- **Time to beat is sparse.** A community check found about 9,600 IGDB time-to-beat rows against about 320,000 games, some resting on very few submissions. Show "unknown" rather than 0, and consider showing the `count`.
- **HowLongToBeat has no official API.** The wrappers scrape the site and have broken under anti-bot measures. Don't depend on it.
- **Attribution is required.** TMDB requires its logo and the Terms of Use notice in an About or Credits section (the FAQ has a shorter variant: "This product uses the TMDB API but is not endorsed or certified by TMDB."). IGDB asks for user-facing attribution to IGDB.com.
- **Commercial use needs agreements.** TMDB's standard licence excludes commercial use, which needs a written agreement and may cost money. IGDB is free for non-commercial use, and monetised products go through an IGDB partnership. Recheck both before charging money or showing ads (INV-007, and the checklist above).
- **Personal use for now.** upnext is built first for the owner's personal, non-commercial use. A commercial version gets explored only after the first build (owner said, 2026-11-26).

## Unconfirmed

- Whether the Twitch Developer Service Agreement allows storing IGDB data in the catalogue.
- Whether keeping item titles past TMDB's 6-month limit is allowed (see Storage and limits).
- Whether users can override provider fields, for example a custom time to beat.
