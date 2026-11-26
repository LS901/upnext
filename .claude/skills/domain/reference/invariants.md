Last reviewed: 2026-11-26

Sources: owner interview, 2026-11-26 (Lewis): picked "library leaks", "silent data loss", "spoilers" and "secrets or data exposed" as must-never-happen. Owner confirmed all seven rules below on 2026-11-26, after setting the visibility model: libraries are public by default and readable by others, owners can opt out to private, notes always stay private, and others never write. Owner follow-up, 2026-11-26: no user ratings, so ratings dropped from INV-001 and INV-003 and play counts added; single lists can be private (INV-002); "more plays on one entry, no duplicates" (INV-008). API research, 2026-11-26, for INV-007. Code today, 2026-11-26: the database model, email sign-in and the INV-005 scan are built (`supabase/migrations/`, `supabase/tests/`, `e2e/`); INV-004, INV-006 and the import half of INV-003 have no code yet. INV-009 was proposed in the same change and awaits the owner.

# Invariants: what must never happen

Each entry says:
- what must never happen;
- why it matters;
- which repos must enforce it;
- what the code does today;
- how to test it at the boundary (a real route, handler or rendered page against a test database, with the clock frozen where time matters);
- its status.

**Confirmed** means the owner agreed the rule. It does **not** mean the code meets it: read "Code today".

Rules for this file (the team-workflow session-start check enforces them):
- IDs run `INV-001`, `INV-002`, … in order, top to bottom.
- Every entry has the six bullet fields below, and a status of `Confirmed` or `Unconfirmed`.
- Confirmed entries sit under `## Confirmed`. Unconfirmed entries sit under `## Unconfirmed`, which is always the last `##` heading.

## Confirmed

### INV-001 — No user ever changes another user's library
- **Never:** a user creates, changes or deletes another user's library entries, statuses, season progress, play counts, notes or lists. Others may only read, and only what INV-002 allows.
- **Why:** trust. A library is a personal record, and only its owner may shape it.
- **Enforced by:** upnext (Supabase row-level security on every user-owned table, allowing writes only where `user_id = auth.uid()`, plus server-side checks in route handlers).
- **Code today:** Row-level security is on `profiles`, `library_entries`, `entry_notes` and `progress_exclusions`, and every write policy checks `user_id = auth.uid()` (`id = auth.uid()` for profiles). `items` and `seasons` have no write policies, so only the service role writes the catalogue. Tests, run against local Supabase through the real client: `supabase/tests/profiles.test.ts`, `library-entries.test.ts`, `notes-and-exclusions.test.ts` and `catalogue.test.ts`. Gap: lists don't exist yet, so list writes are untested; no route handler writes user data yet.
- **Test at the boundary:** against local Supabase, sign in as invented user B and insert, update and delete user A's entries, season statuses and lists through the real client (anon key with B's session). Expect every write rejected and A's rows unchanged.
- **Status:** Confirmed

### INV-002 — Private libraries, private lists and all notes are never shown to anyone but their owner
- **Never:** another person, signed in or not, sees a library its owner made private, a list its owner made private, or any user's notes. Libraries and lists are public by default. Notes are always private.
- **Why:** privacy. Opting out must really hide the library or list, and notes are personal.
- **Enforced by:** upnext (RLS select policies, profile and library pages, any API that returns entries).
- **Code today:** A library is public unless `profiles.library_private` is set. The select policies on `library_entries` and `progress_exclusions` allow the owner, or anyone when the owner's profile isn't private. `entry_notes` is readable by its owner only, and its insert policy requires the caller to own the target entry, so another user can't even learn whether a note exists (`supabase/migrations/20261126083849_notes_insert_owns_entry.sql`). Tests: `supabase/tests/library-entries.test.ts` (public by default, hidden when private) and `supabase/tests/notes-and-exclusions.test.ts` (notes, exclusions). Gap: no library pages or private lists yet.
- **Test at the boundary:** for invented user A with a note on one entry, render A's library page signed out and as user B. Expect the entries and no note text. Make one of A's lists private and render A's profile and that list's URL as B. Expect the list absent and its URL not-found. Then set A's library to private and render again. Expect not-found or empty, and a direct select of A's rows as B returns zero rows.
- **Status:** Confirmed

### INV-003 — User data is never silently lost or overwritten
- **Never:** a user's status, season progress, play count, notes or dates are deleted or overwritten by a metadata refresh, import, sync or conflict, or anything other than that user's explicit action.
- **Why:** the history is the product. Losing it destroys the user's record and their trust.
- **Enforced by:** upnext (metadata refresh jobs, imports, write handlers).
- **Code today:** Partly. Foreign keys from `library_entries` and `progress_exclusions` to `items` and `seasons` are `on delete restrict`, so removing a catalogue row a user tracks fails instead of deleting their data (`supabase/migrations/20261126082919_library_entries.sql`, `20261126083314_notes_and_exclusions.sql`). Tests: "the catalogue can't delete a tracked season" in `supabase/tests/library-entries.test.ts`, and the excluded-season equivalent in `supabase/tests/notes-and-exclusions.test.ts`. Gap: there is no metadata refresh or import yet, so the refresh test below can't run.
- **Test at the boundary:** seed an invented entry with a play count, notes and season statuses. Run the real refresh against stubbed provider responses that change the title, runtime and season count. Expect the item fields updated and every user field unchanged.
- **Status:** Confirmed

### INV-004 — No spoilers past the user's progress
- **Never:** season synopses, episode titles or stills for seasons after the user's current season progress are shown unless the user opts in.
- **Why:** spoiling a show ruins what the user came for.
- **Enforced by:** upnext (show and season pages, search results, notifications).
- **Code today:** Gap: no code yet.
- **Test at the boundary:** render the show page for an invented user partway through season 1 of a three-season show. Expect no season 2 or 3 synopsis text in the HTML.
- **Status:** Confirmed

### INV-005 — Secrets never reach the browser
- **Never:** the Supabase service-role key, the TMDB API key or token, or the Twitch/IGDB client secret or access token appears in client bundles, page HTML, API responses or logs.
- **Why:** a leaked service-role key bypasses all row-level security (INV-001, INV-002), and leaked provider keys can be abused and revoked.
- **Enforced by:** upnext (server-only modules, environment variables without `NEXT_PUBLIC_`).
- **Code today:** `src/lib/supabase/server.ts` imports `server-only`. App code reads only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and none reads the service-role key (only the tests do: `supabase/tests/global-setup.ts` reads it from `npx supabase status -o env`, and `supabase/tests/helpers.ts` uses the injected key). `playwright.config.ts` builds with sentinel values for every server-only variable, and `e2e/secrets.spec.ts` scans `.next/static` and the HTML of `/` and `/login` for them. Gap: API responses and logs aren't scanned, and the provider keys have no code yet.
- **Test at the boundary:** build with invented sentinel key values, then search `.next/static` and the rendered HTML and route responses for each sentinel. Expect no match.
- **Status:** Confirmed

### INV-006 — User data is never sent to third parties
- **Never:** user identifiers, emails, notes or library contents are sent to TMDB, IGDB or any other outside service. Provider requests carry only search terms and item IDs.
- **Why:** privacy. Users didn't agree to share their data with providers.
- **Enforced by:** upnext (provider client modules).
- **Code today:** Gap: no code yet.
- **Test at the boundary:** call the real search and refresh handlers as an invented user, with provider HTTP intercepted. Expect no user ID, email or note text in any intercepted request URL, header or body.
- **Status:** Confirmed

### INV-007 — Provider data is never shown without its required attribution or outside its licence
- **Never:** TMDB or IGDB data is shown without the attribution each requires, or is used commercially (paid tiers, ads) without the agreement each requires. upnext is personal, non-commercial use for now (owner said, 2026-11-26).
- **Why:** breaking the terms can get the API keys revoked, which takes away the catalogue, and brings legal risk.
- **Enforced by:** upnext (About/Credits page, and the decision to go commercial).
- **Code today:** `src/app/credits/page.tsx` shows the TMDB notice and links IGDB.com; `src/app/layout.tsx` links Credits from every page. Covered by `src/app/credits/page.test.tsx` and `e2e/smoke.spec.ts`. Gap: no TMDB logo yet (check whether TMDB's terms require one before showing TMDB data).
- **Test at the boundary:** render the About/Credits page and expect the exact TMDB notice text and an IGDB attribution. The commercial part is a release check: recheck both providers' terms before any paid tier or ads.
- **Status:** Confirmed

### INV-008 — A user never has two library entries for the same item
- **Never:** a user's library holds two entries for one item. A rewatch or replay adds to the existing entry's play count instead.
- **Why:** duplicates split one item's history across entries, so play counts, statuses and lists stop agreeing.
- **Enforced by:** upnext (a unique constraint on the user and item columns of the library entry table, and add or import handlers that update the existing entry rather than insert).
- **Code today:** `library_entries` has `unique (user_id, item_id)` and `unique (user_id, season_id)` (`supabase/migrations/20261126082919_library_entries.sql`), tested in `supabase/tests/library-entries.test.ts` ("INV-008: no duplicate entries": a second insert of the same movie or season fails, and two different seasons of one show are fine). Gap: no add or import handler yet, so the "update the existing entry" half isn't built.
- **Test at the boundary:** as an invented user, add the same item twice through the real add handler, then import a file listing it again. Expect one entry, and a direct insert of a duplicate row rejected by the database.
- **Status:** Confirmed

## Unconfirmed

<!-- New rules go here until the owner confirms them. -->

### INV-009 — A user's email is never shown to anyone else
- **Never:** a user's email address appears to another user or a signed-out visitor: in a profile, a library page, a username, an API response or a page's HTML.
- **Why:** privacy. Profiles and libraries are public by default, so anything copied into them is world-readable. Proposed in the library and sign-in design, 2026-11-26; owner to confirm.
- **Enforced by:** upnext (the `profiles` table has no email column; the sign-up trigger makes a random username; pages and handlers must never select from `auth.users`).
- **Code today:** `profiles` holds no email, and `handle_new_user()` generates `user-` plus 8 random characters (`supabase/migrations/20261126082056_profiles.sql`). Tests: `supabase/tests/profiles.test.ts` ("signing up creates a profile with a generated username", "profiles have no email column"). Gap: the profiles update policy lets a user set their own username to anything, including an email; username rules are a later task. The email also appears in the `/login?sent=` URL in the user's own browser.
- **Test at the boundary:** as invented user A, render A's public profile and library signed out and as user B. Expect the email, and its local part, nowhere in the HTML or responses.
- **Status:** Unconfirmed
