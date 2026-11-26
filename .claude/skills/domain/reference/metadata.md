Last reviewed: 2026-11-26

Sources: owner interview, 2026-11-26 (Lewis); API research, 2026-11-26: TMDB API Terms of Use (themoviedb.org/api-terms-of-use) and FAQ (developer.themoviedb.org/docs/faq); IGDB API docs (api-docs.igdb.com) and partnership page (igdb.com/api); Letterboxd API page (letterboxd.com/api-beta); community reports on HowLongToBeat wrappers; owner follow-up, 2026-11-26 (review scores); owner on books, 2026-11-26; Open Library proposal from research, not yet checked against its docs; owner on the book provider (Open Library if it is the best free source, after a comparison), 2026-11-26. No provider code yet.

# Metadata: where item data comes from

The owner asked for useful item info when items are pulled in: time to finish for movies and TV, and estimated story and 100% hours for games (owner said, 2026-11-26). The providers below come from research, and the owner has not yet chosen them.

## Providers (proposed)

| Media type | Provider | What we take | Why |
|---|---|---|---|
| Movie | TMDB | title, poster, release date, runtime (time to finish), genres, review score | The common choice for film and TV apps. Letterboxd points developers to TMDB for film data. |
| Show | TMDB | title, poster, seasons, episode runtimes (summed per season for time to finish), review score | Has season and episode detail, so a per-season time can be derived. |
| Game | IGDB (Twitch) | title, cover, platforms, release date, time to beat (`hastily`, `normally`, `completely`, `count`), review scores | The common game database. Its official `game_time_to_beats` endpoint gives story and 100% estimates. |

## Books (planned)

Books are a planned fourth media type, after the TMDB and IGDB import (owner said, 2026-11-26). Proposed provider, not yet checked against its docs: **Open Library**. It is free, needs no key and its data is open. Time to finish would come from the page count, and the review score from its ratings.

The owner accepts Open Library **if it is the best free source** (owner said, 2026-11-26), so it stays proposed. The books task starts by comparing free book sources (Open Library, Google Books, Hardcover) on series data, audiobook editions, ratings and terms, and picks from that. Series and audiobooks are described in `library-and-status.md`.

## Review scores

The owner wants review info pulled in from the providers, and upnext has no user ratings of its own (owner said, 2026-11-26). Proposed fields, **not yet checked against the API docs**: verify them when building the provider clients.

| Provider | Fields | Meaning |
|---|---|---|
| TMDB (movie, show) | `vote_average`, `vote_count` | TMDB users' average score out of 10, and how many votes |
| IGDB (game) | `rating`, `rating_count` | IGDB users' score out of 100 |
| IGDB (game) | `aggregated_rating`, `aggregated_rating_count` | Critics' score out of 100, from outside reviews |

Show the vote count beside a score, and "no score" rather than 0 when a score is missing or rests on very few votes.

## Rules of thumb

- **Provider data is not user data.** A refresh may update item fields. It must never touch a library entry's user fields (`invariants.md`).
- **Time to beat is sparse.** A community check found about 9,600 IGDB time-to-beat rows against about 320,000 games, some resting on very few submissions. Show "unknown" rather than 0, and consider showing the `count`.
- **HowLongToBeat has no official API.** The wrappers scrape the site and have broken under anti-bot measures. Don't depend on it.
- **Attribution is required.** TMDB requires the wording "This product uses the TMDB API but is not endorsed or certified by TMDB." in an About or Credits section. IGDB asks for user-facing attribution to IGDB.com.
- **Commercial use needs agreements.** TMDB's standard licence excludes commercial use, which needs a written agreement and may cost money. IGDB is free for non-commercial use, and monetised products go through an IGDB partnership. Recheck both before charging money or showing ads (INV-007).
- **Personal use for now.** upnext is built first for the owner's personal, non-commercial use. A commercial version gets explored only after the first build (owner said, 2026-11-26).

## Unconfirmed

- The owner has not formally chosen the providers above (INV-007, which the owner confirmed, names them).
- How long provider data may be cached or stored. One community reading of TMDB's terms says server-side caching isn't allowed, but that is not an official ruling. Read the current terms before designing storage.
- Whether users can override provider fields, for example a custom time to beat.
- The book provider: Open Library if the comparison with Google Books and Hardcover finds it the best free source (owner said, 2026-11-26), and where audiobook data comes from.
