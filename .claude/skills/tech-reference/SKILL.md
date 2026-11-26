---
name: tech-reference
description: Technical reference for upnext (Next.js App Router, TypeScript, Supabase Postgres and Auth, PWA, TMDB and IGDB integrations) - structure, stack, data layer, auth, server and API patterns, tests, conventions and known gotchas. Load it before changing code, designing a feature or reviewing a change.
---

# tech-reference

How the codebase is built, across repos. Facts about a single repo belong in that repo's `CLAUDE.md`, and that file wins when the two disagree. Domain meaning and invariants live in the project's `domain` skill.

<!--
Filling in this skill: fill in each section from the code, not from memory, citing
repo, file and line where you can. Replace the description above with your stack
(for example "Next.js, PostgreSQL, Stripe") so the skill loads when it should.
Delete sections that don't apply. Keep it factual; preferences go in AGREEMENT.md.
-->

## 1. Structure

<!-- Repos or packages, what each does, ports, how they talk to each other, local services. -->

Planned, not yet scaffolded (owner said, 2026-11-26). Recheck against the code once it exists.

- One repo, `upnext`: a Next.js app that serves the UI and route handlers, plus a `supabase/` folder for migrations and seed data.
- Local services: Supabase through the Supabase CLI (`npx supabase start`, needs Docker).
- Outside services: TMDB (movies and TV) and IGDB (games), called from the server only. See the `domain` skill's `reference/metadata.md`.

## 2. Stack

<!-- Languages, frameworks, key libraries and their versions. -->

Planned (owner said, 2026-11-26). There are no versions until the scaffold lands.

- TypeScript, Next.js (App Router), Tailwind, npm
- Supabase: Postgres + Auth
- Installable PWA
- Tests: Vitest (unit, route and handler), Playwright (e2e)

## 3. Data layer

<!-- Database, schema location, query patterns, migrations, transactions, seed data. -->

TODO

## 4. Auth

<!-- Session shape, user types and roles, how routes are protected. -->

TODO

## 5. Server and API patterns

<!-- Handlers, actions, background jobs, file uploads, email, third-party integrations. -->

TODO

## 6. Tests

<!-- Test runners, where tests live, fixtures, end-to-end setup, how to run one file. -->

TODO

## 7. Conventions

<!-- Formatting, lint rules, naming, file layout, typing patterns. -->

TODO

## 8. Gotchas

<!-- Traps that have bitten people before. One line each, with the fix. -->

TODO
