# upnext

Backlog and tracker for movies, TV shows and games: what you're watching or playing,
what's next, and what you've finished. Installable web app (PWA).

Status: not scaffolded yet. The commands below are planned; update this file when
the scaffold lands.

## Stack
- Next.js (App Router) + TypeScript, Tailwind, npm
- Supabase: Postgres + Auth. Local dev uses the Supabase CLI (`supabase start`, needs Docker).
- Tests: Vitest (unit + route/handler), Playwright (e2e)

## Commands
- Install: `npm install`
- Dev: `npm run dev`
- Local DB: `npx supabase start` / `npx supabase db reset` (applies migrations + seed)
- Lint: `npm run lint` · Types: `npx tsc --noEmit` · Tests: `npm test` · E2E: `npm run e2e`

## Check command (definition of done)
`npm run check` = `npm run lint && npx tsc --noEmit && npm test`
One test file: `npx vitest run path/to/file.test.ts`
Boundary tests that hit the DB need `npx supabase start` running first.

## Where things live
- `src/app/`: routes and route handlers
- `supabase/migrations/`: SQL migrations (source of truth for the schema)
- `supabase/seed.sql`: invented seed data only, never real users

## Conventions
- Secrets go in `.env.local` (gitignored). Never commit Supabase service-role keys.
- Domain terms and invariants live in the `domain` skill (`.claude/skills/domain/`); technical
  reference in `.claude/skills/tech-reference/`. Don't copy them into this file.
