import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { localSupabase } from "./local-supabase";

// playwright.config.ts passes these to the build and the server as the real secrets' env names:
// the local service-role key (the app needs the real one at runtime) and fake provider secrets.
// If any of them shows up in what the browser receives, a server secret has leaked (INV-005).
// Reported by name, so a failure never prints a key.
const SENTINELS: Record<string, string> = {
  SUPABASE_SERVICE_ROLE_KEY: localSupabase().serviceRoleKey,
  TMDB_API_READ_ACCESS_TOKEN: "SENTINEL_TMDB_7f3a",
  IGDB_CLIENT_ID: "SENTINEL_IGDB_ID_7f3a",
  IGDB_CLIENT_SECRET: "SENTINEL_IGDB_SECRET_7f3a",
  CRON_SECRET: "SENTINEL_CRON_7f3a",
};

const PAGES = ["/", "/login", "/search", "/library"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function leaksIn(label: string, content: string): string[] {
  return Object.entries(SENTINELS)
    .filter(([, value]) => content.includes(value))
    .map(([name]) => `${name} found in ${label}`);
}

test("INV-005: no server secret in client bundles or pages", async ({ request }) => {
  const leaks: string[] = [];

  const bundles = filesUnder(join(process.cwd(), ".next", "static"));
  expect(bundles.length, "expected a production build in .next/static").toBeGreaterThan(0);
  for (const file of bundles) {
    leaks.push(...leaksIn(file, readFileSync(file).toString("latin1")));
  }

  for (const path of PAGES) {
    const response = await request.get(path);
    expect(response.ok(), `GET ${path}`).toBe(true);
    leaks.push(...leaksIn(`the HTML of ${path}`, await response.text()));
  }

  expect(leaks).toEqual([]);
});
