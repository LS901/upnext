Last reviewed: 2026-11-26

Sources: owner interview, 2026-11-26 (Lewis); API research, 2026-11-26: TMDB API Terms of Use (themoviedb.org/api-terms-of-use) and FAQ (developer.themoviedb.org/docs/faq); IGDB API docs (api-docs.igdb.com) and partnership page (igdb.com/api); Letterboxd API page (letterboxd.com/api-beta); community reports on HowLongToBeat wrappers. No code yet.

# Metadata: where item data comes from

The owner asked for useful item info when items are pulled in: time to finish for movies and TV, and estimated story and 100% hours for games (owner said, 2026-11-26). The providers below come from research, and the owner has not yet chosen them.

## Providers (proposed)

| Media type | Provider | What we take | Why |
|---|---|---|---|
| Movie | TMDB | title, poster, release date, runtime (time to finish), genres | The common choice for film and TV apps. Letterboxd points developers to TMDB for film data. |
| Show | TMDB | title, poster, seasons, episode runtimes (summed per season for time to finish) | Has season and episode detail, so a per-season time can be derived. |
| Game | IGDB (Twitch) | title, cover, platforms, release date, time to beat (`hastily`, `normally`, `completely`, `count`) | The common game database. Its official `game_time_to_beats` endpoint gives story and 100% estimates. |

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
