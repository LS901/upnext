import { randomBytes } from "node:crypto";
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

// The stub provider server (e2e/stub-providers.ts) that playwright.config.ts starts.
const STUB = "http://127.0.0.1:3101";
const APP = "http://localhost:3100";

type Account = { state: Awaited<ReturnType<BrowserContext["storageState"]>>; username: string };

// One signed-in user per worker (local Auth rate-limits sign-in emails), and
// every test here runs in that one worker, in order. Tests use different books,
// so they don't depend on each other's additions.
const test = base.extend<object, { account: Account }>({
  account: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({ baseURL: APP });
      const page = await context.newPage();
      const email = newEmail();
      await signInByLink(page, email, email);
      const username = (await usernameInHeader(page).textContent())!;
      const state = await context.storageState();
      await context.close();
      await provide({ state, username });
    },
    { scope: "worker" },
  ],
  storageState: async ({ account }, provide) => provide(account.state),
});
test.describe.configure({ mode: "default" });

// Adding a book imports it from Hardcover, whose requests are spaced a second apart
// and shared with the other specs running at once, so allow for the wait (the shared 1 s Hardcover spacing).
const SLOW = { timeout: 30_000 };

// Cover URLs point at the real image CDNs; never let the browser fetch them.
test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/(image\.tmdb\.org|images\.igdb\.com|assets\.hardcover\.app)\//, (route) =>
    route.abort(),
  );
});

type StubRequest = { provider: string; path: string; term?: string };

async function stubRequests(provider?: "hardcover"): Promise<StubRequest[]> {
  const query = provider ? `?provider=${provider}` : "";
  return (await (await fetch(`${STUB}/__requests${query}`)).json()) as StubRequest[];
}

// A search term no other test uses, so the stub's log can be read per search.
function unique(term: string): string {
  return `${term} ${randomBytes(3).toString("hex")}`;
}

async function search(page: Page, term: string) {
  await page.getByLabel("Search movies, TV and games").fill(term);
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === term.trim());
}

function result(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) });
}

// The user's entries for a Hardcover book, by version, read as admin.
async function versionsOwned(username: string, providerId: string): Promise<string[]> {
  const admin = adminClient();
  const { data: profile, error } = await admin.from("profiles").select("id").eq("username", username).single();
  if (error) throw error;
  const { data: items, error: itemsError } = await admin
    .from("items")
    .select("id")
    .eq("provider", "hardcover")
    .eq("provider_id", providerId);
  if (itemsError) throw itemsError;
  const { data: entries, error: entriesError } = await admin
    .from("library_entries")
    .select("book_version")
    .eq("user_id", profile.id)
    .in(
      "item_id",
      items.map((i) => i.id),
    );
  if (entriesError) throw entriesError;
  return entries.map((e) => e.book_version!).sort();
}

test("a book result offers print and audiobook, and only print when there's no audiobook", async ({ page }) => {
  await page.goto("/search");
  await search(page, unique("Lantern"));

  const tide = result(page, "The Lantern Tide");
  await expect(tide).toContainText("Book", SLOW);
  await expect(tide).toContainText("2018");
  await expect(tide.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await expect(tide.getByRole("button", { name: "Add audiobook" })).toBeVisible();

  const orchard = result(page, "Paper Orchard");
  await expect(orchard.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await expect(orchard.getByRole("button", { name: "Add audiobook" })).toHaveCount(0);
});

test("print and audiobook are added separately, each with its own in-library state", async ({ page, account }) => {
  await page.goto("/search");
  await search(page, unique("Lantern"));

  const tide = result(page, "The Lantern Tide");
  await tide.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page).toHaveURL(/added=1/, SLOW);
  await expect(tide.getByRole("button", { name: "In your library", exact: true })).toBeDisabled(SLOW);
  await expect(tide.getByRole("button", { name: "Add audiobook" })).toBeEnabled();
  await expect(tide.getByRole("button", { name: "Audiobook in your library" })).toHaveCount(0);
  expect(await versionsOwned(account.username, "8101")).toEqual(["print"]);

  await tide.getByRole("button", { name: "Add audiobook" }).click();
  await expect(tide.getByRole("button", { name: "Audiobook in your library" })).toBeDisabled(SLOW);
  await expect(tide.getByRole("button", { name: "In your library", exact: true })).toBeDisabled();
  await expect(tide.getByRole("button", { name: "Add audiobook" })).toHaveCount(0);
  expect(await versionsOwned(account.username, "8101")).toEqual(["audio", "print"]);
});

test("double-clicking Add audiobook leaves one audio entry, and print still adds", async ({ page, account }) => {
  await page.goto("/search");
  await search(page, unique("Salt"));

  const salt = result(page, "Salt Meridian");
  await salt.getByRole("button", { name: "Add audiobook" }).dblclick();
  await expect(salt.getByRole("button", { name: "Audiobook in your library" })).toBeDisabled(SLOW);
  expect(await versionsOwned(account.username, "8103")).toEqual(["audio"]);

  await salt.getByRole("button", { name: "Add", exact: true }).click();
  await expect(salt.getByRole("button", { name: "In your library", exact: true })).toBeDisabled(SLOW);
  expect(await versionsOwned(account.username, "8103")).toEqual(["audio", "print"]);
});

test("with Books hidden, Hardcover isn't asked", async ({ page }) => {
  await page.goto("/search");
  const term = unique("Kestrel");
  await search(page, term);
  await expect(result(page, "The Lantern Tide")).toBeVisible(SLOW);

  await page.getByRole("checkbox", { name: "Books" }).check();
  await expect(page).toHaveURL(/[?&]exclude=book/);
  await expect(result(page, "Kestrel Morning")).toBeVisible();
  await expect(result(page, "The Lantern Tide")).toHaveCount(0);

  // A fresh term, searched with Books already hidden, never reaches Hardcover.
  const hidden = unique("Kestrel");
  await page.goto(`/search?exclude=book&q=${encodeURIComponent(hidden)}`);
  await expect(result(page, "Kestrel Morning")).toBeVisible(SLOW);
  const seen = (await stubRequests()).filter((r) => r.term === hidden).map((r) => r.provider);
  expect(seen.sort()).toEqual(["igdb", "tmdb"]);
  expect((await stubRequests("hardcover")).filter((r) => r.term === hidden)).toEqual([]);

  // The log works: the same search with Books shown does reach Hardcover.
  const shown = unique("Kestrel");
  await page.goto(`/search?q=${encodeURIComponent(shown)}`);
  await expect(result(page, "The Lantern Tide")).toBeVisible(SLOW);
  expect((await stubRequests("hardcover")).filter((r) => r.term === shown)).toHaveLength(1);
});

test("Hardcover down shows its notice while TMDB and IGDB results still show", async ({ page }) => {
  await page.goto("/search");
  await search(page, unique("Kestrel hardcover-down"));
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't reach Hardcover right now." })).toBeVisible(SLOW);
  await expect(page.getByText("Couldn't reach TMDB right now.")).toHaveCount(0);
  await expect(result(page, "Kestrel Morning")).toBeVisible();
  await expect(result(page, "Clockwork Lighthouse")).toBeVisible();
  await expect(result(page, "The Lantern Tide")).toHaveCount(0);
});
