# upnext

Backlog and tracker for movies, TV shows and games: what you're watching or playing,
what's next, and what you've finished. Installable web app (PWA).

## Stack
- Next.js 16 (App Router, `cacheComponents` on) + TypeScript, Tailwind 4, npm, Node 22
- Supabase: Postgres + Auth. Local dev uses the Supabase CLI (`npx supabase start`, needs Docker).
- Tests: Vitest + Testing Library (unit, rendered pages, handlers), Playwright (e2e, Chromium)

## Commands
- Install: `npm install` (first e2e run also needs `npx playwright install chromium`)
- Dev: `npm run dev`
- Local DB: `npx supabase start` / `npx supabase db reset` (applies migrations + seed)
- DB types: `npm run db:types` regenerates `src/lib/supabase/database.types.ts`; run it after every migration
- Lint: `npm run lint` · Types: `npm run typecheck` · Tests: `npm test` · E2E: `npm run e2e`
- Providers: `npm run providers:check` checks the TMDB and IGDB credentials in `.env.local`; `npm run refresh` runs the catalogue refresh on a running `npm run dev` (needs `CRON_SECRET`). Node 22.6 or later.

## Check command (definition of done)
`npm run check` = `npm run lint && npm run typecheck && npm test`
One test file: `npx vitest run src/path/to/file.test.tsx`
`npm run e2e` builds the app and serves it on port 3100.
`npm test` (so `npm run check`) and `npm run e2e` need `npx supabase start` running first: the database boundary tests in `supabase/tests/` fail without it, on purpose.
`npm run domain:check` checks the domain skill's reference files.
CI (`.github/workflows/`) runs check, e2e, the domain check, gitleaks, `npm audit` and CodeQL on every PR; all must pass to merge into `main`.

## Where things live
- `src/app/`: routes and route handlers; unit tests sit beside the code they cover (here and in `src/lib/`) as `*.test.ts(x)`
- `src/lib/`: `providers/` (TMDB and IGDB clients), `catalogue/` (import and refresh), `library/`, `supabase/`, `auth/`, `format/`
- `scripts/`: the `providers:check` and `refresh` scripts, and `check-knowledge.mjs` (the domain checker)
- `.github/`: CI and CodeQL workflows, Dependabot config and its auto-merge workflow; `.gitleaks.toml` is the secret-scan config
- `e2e/`: Playwright specs and the stub provider server (`stub-providers.ts`, port 3101)
- `supabase/migrations/`: SQL migrations (source of truth for the schema)
- `supabase/seed.sql`: invented seed data only, never real users
- `.env.example`: every env var the app reads; copy to `.env.local`

## Conventions
- Secrets go in `.env.local` (gitignored). Server keys never get a `NEXT_PUBLIC_` prefix.
- Domain terms and invariants live in the `domain` skill (`.claude/skills/domain/`); technical
  reference in `.claude/skills/tech-reference/`. Don't copy them into this file.
- Leave the Next.js block below in place: `next dev` rewrites it.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
