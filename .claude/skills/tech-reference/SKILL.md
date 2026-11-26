---
name: tech-reference
description: Technical reference for upnext (Next.js App Router, TypeScript, Supabase Postgres and Auth, PWA, TMDB and IGDB integrations) - structure, stack, data layer, auth, server and API patterns, tests, conventions and known gotchas. Load it before changing code, designing a feature or reviewing a change.
---

# tech-reference

How the codebase is built. Facts about the repo's commands live in `AGENTS.md` (loaded through `CLAUDE.md`), and that file wins when the two disagree. Domain meaning and invariants live in the project's `domain` skill.

Last checked against the code: 2026-11-26, at the scaffold (no tables, auth or provider clients yet).

## 1. Structure

- One repo, `upnext`: a Next.js app that serves the UI and route handlers, plus `supabase/` for migrations and seed data.
- `src/app/`: App Router routes. Today: `/` (`page.tsx`), `/credits` (`credits/page.tsx`), the web app manifest (`manifest.ts`), app icons (`icon.png`, `apple-icon.png`).
- `public/`: manifest icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`).
- `e2e/`: Playwright specs. Unit tests sit beside the code as `*.test.tsx`.
- Local services: Supabase through the CLI (`npx supabase start`, needs Docker), API on port 54321, Postgres on 54322 (`supabase/config.jsonc`).
- Outside services: TMDB (movies and TV) and IGDB (games), to be called from the server only. See the `domain` skill's `reference/metadata.md`.

## 2. Stack

Versions from `package-lock.json`:

- Next.js 16.4.6 (App Router) with `cacheComponents` and `partialPrefetching` on (`next.config.ts`), React 19.3.0
- TypeScript 5.9.3 (strict), Tailwind 4.3.3 through the `@tailwindcss/turbopack` loader, ESLint 9 with `eslint-config-next`
- Node 22 (`@types/node` ^22)
- Supabase CLI 3.4.0 (dev dependency). No Supabase client library yet: add `@supabase/supabase-js` and `@supabase/ssr` with the first table.
- Vitest 5.1.2 + Testing Library 16 + jsdom; Playwright 1.65.1 (Chromium only)

## 3. Data layer

- Schema source of truth: `supabase/migrations/` (empty so far). `npx supabase db reset` applies migrations, then `supabase/seed.sql`.
- `seed.sql` holds invented data only.
- No tables yet. Every user-owned table needs row-level security for INV-001 and INV-002, and the library entry table needs a unique (user, item) constraint for INV-008.

## 4. Auth

TODO: Supabase Auth is planned and not wired up yet.

## 5. Server and API patterns

- Env vars: listed in `.env.example`; real values go in `.env.local` (gitignored). Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may reach the browser. `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_READ_ACCESS_TOKEN`, `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` are server-only (INV-005).
- No route handlers, server actions or provider clients yet.

## 6. Tests

- `npm test` runs Vitest once over `src/**/*.test.{ts,tsx}` in jsdom (`vitest.config.mts`). One file: `npx vitest run src/app/credits/page.test.tsx`.
- Vitest can render synchronous server and client components. Async server components can't be rendered in Vitest; cover them with Playwright (Next.js testing guide, `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`).
- `npm run e2e` runs Playwright from `e2e/` against a production build served on port 3100 (`playwright.config.ts`). First run needs `npx playwright install chromium`.
- `npm run check` = lint + `npm run typecheck` (`next typegen && tsc --noEmit`) + `npm test`.

## 7. Conventions

- Path alias `@/*` → `src/*`.
- Tests import `test` and `expect` from `vitest` explicitly, even though `globals` is on (it's on only so Testing Library cleans up after each test).
- Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/`: Next 16 differs from older versions (see the managed block in `AGENTS.md`).

## 8. Gotchas

- **`LayoutProps` / `PageProps` not found by `tsc`:** they're generated types. Run `npm run typecheck`, which runs `next typegen` first, not bare `npx tsc --noEmit`.
- **Vitest "failed to find the current suite" on Windows:** a lowercase drive letter in the working directory (`c:\`, VS Code's default) loads Vitest twice. `vitest.config.mts` pins `root` to an uppercase drive letter, which fixes PowerShell (checked with both `c:\` and `C:\`). Git Bash still fails, cause not found; run tests from PowerShell.
- **`AGENTS.md` keeps changing:** `next dev` rewrites the block between the `nextjs-agent-rules` markers. Leave it and commit it.
- **Supabase exposes new tables by default:** `api.auto_expose_new_tables` is unset in `supabase/config.jsonc`, so new `public` tables are reachable through the Data API roles (including `anon`) without explicit grants. Enable RLS in the same migration that creates each table (INV-001, INV-002).
- **Next warns about a `package-lock.json` in a parent folder:** on the owner's machine there's one in `Documents/`. Next ignores it because it's outside the git repo; harmless.
