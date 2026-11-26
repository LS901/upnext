import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// playwright.config.ts passes these to the build and the server as the real secrets' env names.
// If any of them shows up in what the browser receives, a server secret has leaked (INV-005).
const SENTINELS = [
  "SENTINEL_SERVICE_ROLE_7f3a",
  "SENTINEL_TMDB_7f3a",
  "SENTINEL_IGDB_ID_7f3a",
  "SENTINEL_IGDB_SECRET_7f3a",
];

const PAGES = ["/", "/login"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function leaksIn(label: string, content: string): string[] {
  return SENTINELS.filter((sentinel) => content.includes(sentinel)).map(
    (sentinel) => `${sentinel} found in ${label}`
  );
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
