Last reviewed: 2026-11-26

Sources: owner interview, 2026-11-26 (Lewis): picked "library leaks", "silent data loss", "spoilers" and "secrets or data exposed" as must-never-happen. Owner confirmed all seven rules below on 2026-11-26, after setting the visibility model: libraries are public by default and readable by others, owners can opt out to private, notes always stay private, and others never write. API research, 2026-11-26, for INV-007. No code yet: the `upnext` repo is not scaffolded, so every "Code today" is a gap.

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
- **Never:** a user creates, changes or deletes another user's library entries, statuses, season progress, ratings, notes or lists. Others may only read, and only what INV-002 allows.
- **Why:** trust. A library is a personal record, and only its owner may shape it.
- **Enforced by:** upnext (Supabase row-level security on every user-owned table, allowing writes only where `user_id = auth.uid()`, plus server-side checks in route handlers).
- **Code today:** Gap: no code yet.
- **Test at the boundary:** against local Supabase, sign in as invented user B and insert, update and delete user A's entries, ratings and lists through the real client (anon key with B's session). Expect every write rejected and A's rows unchanged.
- **Status:** Confirmed

### INV-002 — Private libraries and all notes are never shown to anyone but their owner
- **Never:** another person, signed in or not, sees a library its owner made private, or sees any user's notes. Libraries are public by default. Notes are always private.
- **Why:** privacy. Opting out must really hide the library, and notes are personal.
- **Enforced by:** upnext (RLS select policies, profile and library pages, any API that returns entries).
- **Code today:** Gap: no code yet.
- **Test at the boundary:** for invented user A with a note on one entry, render A's library page signed out and as user B. Expect the entries and no note text. Then set A's library to private and render again. Expect not-found or empty, and a direct select of A's rows as B returns zero rows.
- **Status:** Confirmed

### INV-003 — User data is never silently lost or overwritten
- **Never:** a user's status, season progress, rating, notes or dates are deleted or overwritten by a metadata refresh, import, sync or conflict, or anything other than that user's explicit action.
- **Why:** the history is the product. Losing it destroys the user's record and their trust.
- **Enforced by:** upnext (metadata refresh jobs, imports, write handlers).
- **Code today:** Gap: no code yet.
- **Test at the boundary:** seed an invented entry with a rating, notes and season progress. Run the real refresh against stubbed provider responses that change the title, runtime and season count. Expect the item fields updated and every user field unchanged.
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
- **Code today:** Gap: no code yet.
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
- **Code today:** Gap: no code yet.
- **Test at the boundary:** render the About/Credits page and expect the exact TMDB notice text and an IGDB attribution. The commercial part is a release check: recheck both providers' terms before any paid tier or ads.
- **Status:** Confirmed

## Unconfirmed

<!-- New rules go here until the owner confirms them. -->
