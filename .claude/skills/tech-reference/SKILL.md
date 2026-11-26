---
name: tech-reference
description: Technical reference for upnext (Next.js App Router, TypeScript, Supabase Postgres and Auth, PWA, TMDB and IGDB integrations) - structure, stack, data layer, auth, server and API patterns, tests, conventions and known gotchas. Load it before changing code, designing a feature or reviewing a change.
---

# tech-reference

How the codebase is built. Facts about the repo's commands live in `AGENTS.md` (loaded through `CLAUDE.md`), and that file wins when the two disagree. Domain meaning and invariants live in the project's `domain` skill.

Last checked against the code: 2026-11-26, after the library data model and email sign-in (no provider clients, library pages or lists yet).

## 1. Structure

- One repo, `upnext`: a Next.js app that serves the UI and route handlers, plus `supabase/` for migrations and seed data.
- `src/app/`: App Router routes. Today: `/` (`page.tsx`), `/credits`, `/login` (`login/page.tsx`, `login/actions.ts`), `/auth/confirm` (`auth/confirm/route.ts`), the header's `account-menu.tsx`, the web app manifest (`manifest.ts`), app icons (`icon.png`, `apple-icon.png`).
- `src/lib/`: `supabase/` (`server.ts`, generated `database.types.ts`) and `auth/current-user.ts`. `src/proxy.ts` is Next 16's renamed middleware.
- `public/`: manifest icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`).
- `e2e/`: Playwright specs (`smoke`, `sign-in`, `secrets`) and `mailpit.ts`, a helper that reads the sign-in emails. Unit tests sit beside the code as `*.test.ts(x)`. Database boundary tests live in `supabase/tests/`.
- Local services: Supabase through the CLI (`npx supabase start`, needs Docker), API on port 54321, Postgres on 54322 (`supabase/config.jsonc`).
- Outside services: TMDB (movies and TV) and IGDB (games), to be called from the server only. See the `domain` skill's `reference/metadata.md`.

## 2. Stack

Versions from `package-lock.json`:

- Next.js 16.4.6 (App Router) with `cacheComponents` and `partialPrefetching` on (`next.config.ts`), React 19.3.0
- TypeScript 5.9.3 (strict), Tailwind 4.3.3 through the `@tailwindcss/turbopack` loader, ESLint 9 with `eslint-config-next`
- Node 22 (`@types/node` ^22)
- Supabase CLI 3.4.0 (dev dependency); `@supabase/supabase-js` and `@supabase/ssr` for the app, `server-only` to keep server modules out of client bundles
- Vitest 5.1.2 + Testing Library 16 + jsdom; Playwright 1.65.1 (Chromium only)

## 3. Data layer

- Schema source of truth: `supabase/migrations/`, one migration per concern. `npx supabase db reset` applies them, then `supabase/seed.sql` (invented data: two movies, one game, one show with three seasons; no users).
- Enums: `media_type` (`movie`, `show`, `game`), `entry_status` (`backlog`, `in_progress`, `finished`, `paused`, `dropped`), `provider` (`tmdb`, `igdb`).
- Tables, all with row-level security enabled in the migration that creates them:
  - `profiles`: one per auth user, made by the `handle_new_user()` trigger on `auth.users` with a random `user-xxxxxxxx` username (never from the email). Readable by everyone; a user updates only their own row. No email column (proposed INV-009).
  - `items` and `seasons`: the shared catalogue. Readable by everyone, no write policies, so only the service role writes. A season belongs to a show through a composite foreign key `(show_id, show_media_type)`.
  - `library_entries`: one row per movie, game or season (never a show) per user. Unique `(user_id, item_id)` and `(user_id, season_id)` give INV-008; `up_next_position` is allowed only while the status is `backlog`. Readable by the owner, or by anyone when the owner's profile isn't `library_private`; written by the owner only.
  - `entry_notes`: owner-only for every operation, kept apart so a public library can't leak one. The insert policy also requires the caller to own the entry, so another user can't probe whether a note exists (INV-002).
  - `progress_exclusions`: seasons a user leaves out of a show's progress count; same read and write rules as entries. Its own table because a user can exclude a season they never added.
- **Catalogue foreign keys from user data are `on delete restrict`** (`library_entries` to `items` and `seasons`, `progress_exclusions` to `seasons`), so removing a catalogue row can't silently delete a user's data (INV-003). Foreign keys to `auth.users` cascade, so deleting a user removes their data.
- Row-level security is checked with `(select auth.uid())`, and each user-owned table has an index on `user_id`.
- `npm run db:types` regenerates `src/lib/supabase/database.types.ts` from the local database (`supabase gen types typescript --local`). Run it after every migration and commit the result; the CLI's "unformatted" hint can be ignored.

## 4. Auth

Email only: a magic link plus a 6-digit code in the same email (owner said, 2026-11-26). Google and other social providers stay disabled. The code exists because a link opens in the phone's browser, not in the installed app.

- `src/lib/supabase/server.ts`: `createClient()` for server components, actions and route handlers; reads and writes the request's cookies. It awaits `io()` from `next/cache` before creating the client (see Gotchas).
- `src/proxy.ts`: refreshes the Supabase session cookie on each request (`auth.getClaims()`). It guards no route.
- `src/lib/auth/current-user.ts`: `getCurrentUser()` returns `{ id, username }`, or `null` only when there is no session. Any other auth error, profile query error or a missing profile throws, so an outage never looks like being signed out. It reads cookies, so it renders at request time and callers sit behind `<Suspense>`.
- `src/app/login/actions.ts`: `sendSignInEmail` (trims and lowercases the email, `signInWithOtp` with `shouldCreateUser`, redirects to `/login?sent=<email>`; the same message whether or not the address is registered; `?error=send` on failure), `verifyCode` (`verifyOtp` with `type: "email"`) and `signOut`. `signOut` uses supabase-js's default scope (global: it ends the user's sessions on every device) and throws if Supabase reports an error.
- `src/app/auth/confirm/route.ts`: the link's landing. Verifies `token_hash` with `type=email` and redirects home, or to `/login?error=link`. A token hash works even when the link opens in a different browser from the one that asked.
- `src/app/account-menu.tsx` in the layout header, behind `<Suspense>`: the username and a Sign out button, or a Sign in link.
- Email template: `supabase/templates/magic-link.html`, used for both `magic_link` and `confirmation` (a first sign-in may send the confirmation template). It links to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email` and shows `{{ .Token }}`. Configured in `supabase/config.jsonc` with `site_url` `http://localhost:3000` and redirect URLs for ports 3000 and 3100 (the dev and e2e servers).
- No new env vars: the app uses only the Supabase URL and publishable key.

## 5. Server and API patterns

- Env vars: listed in `.env.example`; real values go in `.env.local` (gitignored). Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may reach the browser. `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_READ_ACCESS_TOKEN`, `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` are server-only (INV-005).
- Route handlers and server actions today: `/auth/confirm` and the `/login` actions above. No provider clients yet.
- For local dev, copy `API_URL` and `PUBLISHABLE_KEY` from `npx supabase status -o env` into `.env.local`; e2e passes them to the build itself (`playwright.config.ts`).

## 6. Tests

- `npm test` runs Vitest once with two projects (`vitest.config.mts`):
  - `unit`: `src/**/*.test.{ts,tsx}` in jsdom. One file: `npx vitest run src/app/credits/page.test.tsx`.
  - `db`: `supabase/tests/**/*.test.ts` in node, files run one at a time (`fileParallelism: false`). It needs local Supabase running: `supabase/tests/global-setup.ts` reads the URL and keys from `npx supabase status -o env` and fails with "run npx supabase start" if it's down (it never skips, so `check` can't pass by accident). Run only it with `npx vitest run --project db`.
- Database test helpers (`supabase/tests/helpers.ts`): `adminClient()` (service role), `anonClient()`, `createTestUser(role)` (an invented `@example.test` user made through the admin API, signed in with a random password; the app itself never offers password sign-in) and `deleteTestUsers()`. The tests use the real Supabase client against the real database, so RLS is exercised as production sees it.
- Vitest can render synchronous server and client components. Async server components can't be rendered in Vitest; cover them with Playwright (Next.js testing guide, `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`).
- `npm run e2e` runs Playwright from `e2e/` against a production build served on port 3100 (`playwright.config.ts`). First run needs `npx playwright install chromium`. It also needs local Supabase: the config reads its URL and key from `npx supabase status -o env` and passes them to the build.
- Sign-in e2e reads the emails from Mailpit, Supabase's local mail catcher (`http://127.0.0.1:54324`), through `e2e/mailpit.ts`. It covers the link, the code, sign-out, a returning user and bad codes and links.
- INV-005 scan: `playwright.config.ts` builds with sentinel values for every server-only env var, and `e2e/secrets.spec.ts` searches `.next/static` and the HTML of `/` and `/login` for them.
- `npm run check` = lint + `npm run typecheck` (`next typegen && tsc --noEmit`) + `npm test`. Because `npm test` includes the `db` project, `check` needs `npx supabase start` running.

## 7. Conventions

- Path alias `@/*` → `src/*`.
- Tests import `test` and `expect` from `vitest` explicitly, even though `globals` is on (it's on only so Testing Library cleans up after each test).
- Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/`: Next 16 differs from older versions (see the managed block in `AGENTS.md`).

## 8. Gotchas

- **`LayoutProps` / `PageProps` not found by `tsc`:** they're generated types. Run `npm run typecheck`, which runs `next typegen` first, not bare `npx tsc --noEmit`.
- **Vitest "failed to find the current suite" on Windows:** a lowercase drive letter in the working directory (`c:\`, VS Code's default) loads Vitest twice. `vitest.config.mts` pins `root` to an uppercase drive letter, which fixes PowerShell (checked with both `c:\` and `C:\`). Git Bash still fails, cause not found; run tests from PowerShell.
- **`AGENTS.md` keeps changing:** `next dev` rewrites the block between the `nextjs-agent-rules` markers. Leave it and commit it.
- **Supabase exposes new tables by default:** `api.auto_expose_new_tables` is unset in `supabase/config.jsonc`, so new `public` tables are reachable through the Data API roles (including `anon`) without explicit grants. Every table so far enables RLS in the migration that creates it, and the boundary tests prove writes are refused; keep doing both for each new table (INV-001, INV-002).
- **Next warns about a `package-lock.json` in a parent folder:** if there's one in `Documents/`, Next ignores it because it's outside the git repo; harmless. A parent `node_modules` is not harmless, see the next item.
- **A stray `node_modules` in a parent folder breaks the Supabase CLI:** any `node_modules\.bin` above the repo (for example from an accidental `npm install` in `Documents`) lands on PATH under `npx` and `npm run`. An npm package named `docker` there shadows real Docker, and the CLI fails with "cannot be safely passed to a .bat/.cmd file" or `StatusDbNotRunningError`. Fix: remove the stray parent `node_modules` (and its `package.json`).
- **Local Supabase Auth rate limits can fail repeated e2e runs:** `supabase/config.jsonc` allows about 30 sign-ins and 30 verifications per 5 minutes per IP, and one e2e run uses about 5 sends and 6 verifications. Back-to-back `npm run e2e` runs can trip it. Wait a few minutes, or restart Supabase.
- **`createClient()` awaits `io()` from `next/cache` (Next 16.3+):** every supabase-js client reads the clock to check the session's expiry, and with `partialPrefetching` a link prefetch prerenders with cookies already resolved, which Cache Components rejects (`Route "/": Next.js encountered the unstable value Date.now() while prerendering`). `await io()` keeps the code after it out of prerenders; at request time it resolves at once. Keep it in `src/lib/supabase/server.ts`. The account menu therefore streams in on navigation instead of being prefetched.
- **Anything that reads the session must sit behind `<Suspense>`:** `getCurrentUser()` reads cookies, so it renders at request time (Next guide: `node_modules/next/dist/docs/` on authentication with Cache Components). The header's account menu and the login forms (they read `searchParams`) do.
- **Next 16 calls middleware `proxy`:** the file is `src/proxy.ts`, exporting `proxy`.
- **`getClaims()` in the proxy, `getUser()` in `getCurrentUser()`:** `getClaims()` (cheap, and it refreshes an expiring session) keeps the cookie fresh; `getUser()` checks the token with the Auth server rather than trusting the cookie.
- **A token signed with a rotated key still throws:** a revoked or deleted session counts as "no session" (`null`), but `bad_jwt` makes `getCurrentUser()` throw until the user's cookie is cleared. Rare; known.
- **Supabase env names differ by CLI version:** `npx supabase status -o env` gives `API_URL`, `PUBLISHABLE_KEY` and `SECRET_KEY`, with `ANON_KEY` and `SERVICE_ROLE_KEY` as older names. The test setup and `playwright.config.ts` accept both.
- **Hide whether a row exists:** a policy that only checks `user_id = auth.uid()` lets an insert reach the primary key or foreign key, whose error code (`23505` against `23503`) tells the caller whether another user's row exists. The notes insert policy therefore also requires owning the entry (`20261126083849_notes_insert_owns_entry.sql`). Apply the same thinking to any new private table.
- **Mailpit shows the raw `&` in the HTML part:** `e2e/mailpit.ts` returns the HTML and the text part; the sign-in test reads the code from the text. The link in the HTML needs `&amp;` decoded.
- **The email is in the `/login?sent=` URL**, so it lands in the user's browser history. Accepted for now.
