import { randomBytes } from "node:crypto";
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

// The stub provider server (e2e/stub-providers.ts) that playwright.config.ts starts.
const STUB = "http://127.0.0.1:3101";
const APP = "http://localhost:3100";

type Account = { state: Awaited<ReturnType<BrowserContext["storageState"]>>; username: string };

// One signed-in user per worker (local Auth rate-limits sign-in emails), and
// every test here runs in that one worker, in order. Tests use different items,
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

// Poster URLs point at the real image CDNs; never let the browser fetch them.
test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/(image\.tmdb\.org|images\.igdb\.com)\//, (route) => route.abort());
});

type StubRequest = { provider: "tmdb" | "igdb" | "twitch"; path: string; term?: string };

async function stubRequests(): Promise<StubRequest[]> {
  const res = await fetch(`${STUB}/__requests`);
  return (await res.json()) as StubRequest[];
}

// A search term no other test uses, so the stub's log can be read per search.
function unique(term: string): string {
  return `${term} ${randomBytes(3).toString("hex")}`;
}

async function search(page: Page, term: string) {
  await page.getByLabel("Search movies, TV and games").fill(term);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/[?&]q=/);
}

function result(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) });
}

async function userId(username: string): Promise<string> {
  const { data, error } = await adminClient().from("profiles").select("id").eq("username", username).single();
  if (error) throw error;
  return data.id;
}

async function entryCount(username: string, provider: "tmdb" | "igdb", providerId: string) {
  const admin = adminClient();
  const { data: items, error } = await admin
    .from("items")
    .select("id")
    .eq("provider", provider)
    .eq("provider_id", providerId);
  if (error) throw error;
  const { count, error: countError } = await admin
    .from("library_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", await userId(username))
    .in(
      "item_id",
      items.map((i) => i.id),
    );
  if (countError) throw countError;
  return { items: items.length, entries: count };
}

test("signed-out visitors are sent to sign in", async ({ browser }) => {
  // In a test, newContext() inherits the signed-in storageState unless told otherwise.
  const context = await browser.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();

  await page.goto("/search?q=Kestrel");
  await expect(page).toHaveURL("/login");
  await page.goto("/search/show/9101");
  await expect(page).toHaveURL("/login");

  await context.close();
});

test("an empty search makes no provider calls", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  await expect(page.getByText("Type a title to search.")).toBeVisible();

  await search(page, "   ");
  await expect(page.getByText("Type a title to search.")).toBeVisible();
  await expect(page.getByText("Nothing found.")).toHaveCount(0);

  // No search request with a blank term ever reached a provider (Review Focus 2).
  const blank = (await stubRequests()).filter((r) => r.term !== undefined && r.term.trim() === "");
  expect(blank).toEqual([]);

  // The log works: a real search does reach both providers.
  const term = unique("Kestrel");
  await search(page, term);
  await expect(result(page, "Kestrel Morning")).toBeVisible();
  const seen = (await stubRequests()).filter((r) => r.term === term).map((r) => r.provider);
  expect(seen.sort()).toEqual(["igdb", "tmdb"]);
});

test("search shows both providers and hides excluded types", async ({ page }) => {
  await page.goto("/search");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  await expect(header.getByRole("link", { name: "My library" })).toHaveAttribute("href", "/library");

  await search(page, unique("Kestrel"));
  await expect(result(page, "Kestrel Morning")).toContainText("Movie");
  await expect(result(page, "Kestrel Morning")).toContainText("2019");
  await expect(result(page, "Kestrel Morning").locator("img")).toHaveAttribute(
    "src",
    /^https:\/\/image\.tmdb\.org\/t\/p\//,
  );
  await expect(result(page, "Harbour of Glass")).toContainText("TV");
  await expect(result(page, "Harbour of Glass").getByRole("link", { name: "Choose seasons" })).toHaveAttribute(
    "href",
    "/search/show/9101",
  );
  await expect(result(page, "Clockwork Lighthouse")).toContainText("Game");
  await expect(page.getByText("Invented Person")).toHaveCount(0);

  // Hide games: IGDB isn't asked at all.
  await expect(page.getByRole("heading", { name: "Hide" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Games" }).check();
  const noGames = unique("Kestrel");
  await search(page, noGames);
  await expect(result(page, "Kestrel Morning")).toBeVisible();
  await expect(result(page, "Clockwork Lighthouse")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Games" })).toBeChecked();
  expect((await stubRequests()).filter((r) => r.term === noGames).map((r) => r.provider)).toEqual(["tmdb"]);

  // Hide TV too: movies still show, shows don't.
  await page.getByRole("checkbox", { name: "TV" }).check();
  await search(page, unique("Kestrel"));
  await expect(result(page, "Kestrel Morning")).toBeVisible();
  await expect(result(page, "Harbour of Glass")).toHaveCount(0);

  // Hide movies and TV, show games: TMDB isn't asked.
  await page.getByRole("checkbox", { name: "Movies" }).check();
  await page.getByRole("checkbox", { name: "Games" }).uncheck();
  const gamesOnly = unique("Kestrel");
  await search(page, gamesOnly);
  await expect(result(page, "Clockwork Lighthouse")).toBeVisible();
  await expect(result(page, "Kestrel Morning")).toHaveCount(0);
  expect((await stubRequests()).filter((r) => r.term === gamesOnly).map((r) => r.provider)).toEqual(["igdb"]);

  // Hide all three: no provider is asked, and the page says why it's empty.
  await page.getByRole("checkbox", { name: "Games" }).check();
  const nothingShown = unique("Kestrel");
  await search(page, nothingShown);
  await expect(page.getByText("Everything is hidden. Untick a type to search.")).toBeVisible();
  await expect(page.getByText("Nothing found.")).toHaveCount(0);
  expect((await stubRequests()).filter((r) => r.term === nothingShown)).toEqual([]);
});

test("one provider down still shows the other's results", async ({ page }) => {
  await page.goto("/search");

  await search(page, unique("igdb-down"));
  await expect(page.getByText("Couldn't reach IGDB right now.")).toBeVisible();
  await expect(result(page, "Kestrel Morning")).toBeVisible();
  await expect(page.getByText("Couldn't reach TMDB right now.")).toHaveCount(0);

  // TMDB rate-limited (429).
  await search(page, unique("tmdb-down"));
  await expect(page.getByText("Couldn't reach TMDB right now.")).toBeVisible();
  await expect(result(page, "Clockwork Lighthouse")).toBeVisible();
  await expect(result(page, "Kestrel Morning")).toHaveCount(0);

  await search(page, unique("nothing"));
  await expect(page.getByText("Nothing found.")).toBeVisible();
});

test("adding a movie twice keeps one entry", async ({ page, context, account }) => {
  await page.goto("/search");
  await search(page, unique("Kestrel"));

  // Double-click (Review Focus 3).
  const movie = result(page, "Kestrel Morning");
  await movie.getByRole("button", { name: "Add" }).dblclick();
  await expect(page).toHaveURL(/[?&]added=1/);
  await expect(movie.getByRole("button", { name: "In your library" })).toBeDisabled();
  await expect(movie.getByRole("button", { name: "Add" })).toHaveCount(0);
  expect(await entryCount(account.username, "tmdb", "9001")).toEqual({ items: 1, entries: 1 });

  // The same game added from two tabs at once.
  const other = await context.newPage();
  for (const tab of [page, other]) {
    await tab.goto(`/search?q=${encodeURIComponent(unique("Clockwork"))}`);
    await expect(result(tab, "Clockwork Lighthouse").getByRole("button", { name: "Add" })).toBeVisible();
  }
  await Promise.all(
    [page, other].map((tab) => result(tab, "Clockwork Lighthouse").getByRole("button", { name: "Add" }).click()),
  );
  for (const tab of [page, other]) {
    await expect(result(tab, "Clockwork Lighthouse").getByRole("button", { name: "In your library" })).toBeVisible();
  }
  expect(await entryCount(account.username, "igdb", "7001")).toEqual({ items: 1, entries: 1 });
});

test("INV-004: the season picker shows no synopses", async ({ page }) => {
  await page.goto("/search");
  await search(page, unique("Harbour"));
  await result(page, "Harbour of Glass").getByRole("link", { name: "Choose seasons" }).click();

  await expect(page).toHaveURL("/search/show/9101");
  await expect(page.getByRole("heading", { level: 1, name: "Harbour of Glass" })).toBeVisible();
  await expect(page).toHaveTitle("Harbour of Glass · upnext");
  for (const label of [
    "Specials · 2 episodes · 2022",
    "Season 1 · 8 episodes · 2021",
    "Season 2 · 8 episodes · 2022",
    "Season 3 · 6 episodes · 2024",
  ]) {
    await expect(page.getByRole("checkbox", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Add seasons" })).toBeVisible();

  // Neither the rendered page nor the raw HTML (with its RSC payload) carries any.
  const html = await (await page.request.get("/search/show/9101")).text();
  expect(html).toContain("Harbour of Glass");
  expect(html).not.toContain("SPOILER-OVERVIEW-");
  expect(html).not.toContain("SPOILER-EPISODE-");
  expect(await page.content()).not.toContain("SPOILER-");
});

test("a show with only specials shows them and adds them", async ({ page, account }) => {
  // No seasons at all (Review Focus 5).
  await page.goto("/search/show/9103");
  await expect(page.getByRole("heading", { level: 1, name: "Unwritten Tides" })).toBeVisible();
  await expect(page.getByText("No seasons yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add seasons" })).toHaveCount(0);

  // Only specials, with no episode count, air date or runtimes.
  await page.goto("/search/show/9102");
  await expect(page.getByRole("heading", { level: 1, name: "Saltmarsh Specials" })).toBeVisible();
  const specials = page.getByRole("checkbox", { name: "Specials", exact: true });
  await specials.check();
  await page.getByRole("button", { name: "Add seasons" }).click();

  await expect(page).toHaveURL("/search/show/9102?added=1");
  await expect(specials).toBeChecked();
  await expect(specials).toBeDisabled();
  // Every season is in the library, so there's nothing left to add.
  await expect(page.getByRole("button", { name: "Add seasons" })).toHaveCount(0);

  const admin = adminClient();
  const { data: show } = await admin
    .from("items")
    .select("id, seasons(id, season_number)")
    .eq("provider", "tmdb")
    .eq("media_type", "show")
    .eq("provider_id", "9102")
    .single();
  expect(show?.seasons.map((s) => s.season_number)).toEqual([0]);
  const { count } = await admin
    .from("library_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", await userId(account.username))
    .eq("season_id", show!.seasons[0].id);
  expect(count).toBe(1);

  await page.goto(`/search?q=${encodeURIComponent(unique("Saltmarsh"))}`);
  await expect(result(page, "Saltmarsh Specials").getByRole("button", { name: "In your library" })).toBeVisible();
  await expect(result(page, "Saltmarsh Specials").getByRole("link", { name: "Choose seasons" })).toBeVisible();
});
