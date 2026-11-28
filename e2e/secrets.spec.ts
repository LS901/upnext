import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { adminClient, localSupabase } from "./local-supabase";

// playwright.config.ts passes these to the build and the server as the real secrets' env names:
// the local service-role key (the app needs the real one at runtime) and fake provider secrets.
// If any of them shows up in what the browser receives, a server secret has leaked (INV-005).
// Reported by name, so a failure never prints a key.
const SENTINELS: Record<string, string> = {
  SUPABASE_SERVICE_ROLE_KEY: localSupabase().serviceRoleKey,
  TMDB_API_READ_ACCESS_TOKEN: "SENTINEL_TMDB_7f3a",
  IGDB_CLIENT_ID: "SENTINEL_IGDB_ID_7f3a",
  IGDB_CLIENT_SECRET: "SENTINEL_IGDB_SECRET_7f3a",
  HARDCOVER_API_TOKEN: "SENTINEL_HARDCOVER_7f3a",
  CRON_SECRET: "SENTINEL_CRON_7f3a",
};

const PAGES = ["/", "/login", "/search", "/library", "/settings", "/lists"];
const SIGNED_IN_ONLY = ["/search", "/library", "/settings", "/lists"];
// The meta refresh Next streams for a redirect: standard HTML, which a browser
// without JavaScript follows. Matched on the attributes, not Next's element id or delay.
const LOGIN_REFRESH = /<meta\b[^>]*http-equiv="refresh"[^>]*content="\d+;\s*url=\/login"/i;

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
    const html = await response.text();
    leaks.push(...leaksIn(`the HTML of ${path}`, html));
    // Signed out, these answer 200 with their prerendered shell, and the
    // redirect to sign-in is streamed into the HTML. Check it's there, so the
    // HTML scanned above is the signed-out page (signed-in HTML isn't scanned).
    if (SIGNED_IN_ONLY.includes(path)) expect(html, `GET ${path}`).toMatch(LOGIN_REFRESH);
  }

  expect(leaks).toEqual([]);
});

// INV-009: the pages anyone can read about a user (their profile and a public
// list) never carry that user's email, nor its local part. The user is made
// through the admin API, so no sign-in email is sent; the pages are read signed out.
test("INV-009: no email on a profile or a public list", async ({ request }) => {
  const admin = adminClient();
  const local = `inv009-${randomBytes(4).toString("hex")}`;
  const email = `${local}@example.test`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const userId = created.user.id;
  try {
    const { data: profile, error: profileError } = await admin.from("profiles").select("username").eq("id", userId).single();
    if (profileError) throw profileError;
    const { data: item, error: itemError } = await admin
      .from("items")
      .insert({ provider: "manual", media_type: "other", provider_id: randomUUID(), title: "Invented Inv009 Thing", owner_id: userId })
      .select("id")
      .single();
    if (itemError) throw itemError;
    const { data: entry, error: entryError } = await admin
      .from("library_entries")
      .insert({ user_id: userId, item_id: item.id, item_media_type: "other", status: "finished" })
      .select("id")
      .single();
    if (entryError) throw entryError;
    const { data: list, error: listError } = await admin
      .from("lists")
      .insert({ user_id: userId, name: "Invented Inv009 List" })
      .select("id")
      .single();
    if (listError) throw listError;
    const { error: putError } = await admin.from("list_entries").insert({ list_id: list.id, entry_id: entry.id, position: 1 });
    if (putError) throw putError;

    for (const path of [`/u/${profile.username}`, `/lists/${list.id}`]) {
      const response = await request.get(path);
      expect(response.ok(), `GET ${path}`).toBe(true);
      const html = await response.text();
      // The real page, not an empty shell: the entry is on both.
      expect(html, `GET ${path}`).toContain("Invented Inv009 Thing");
      expect(html.includes(email), `the email in the HTML of ${path}`).toBe(false);
      expect(html.includes(local), `the email's local part in the HTML of ${path}`).toBe(false);
    }
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});
