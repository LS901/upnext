import { expect, test as base, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

// Recommendations by genre under an empty search box, and genre pins on
// /settings. The library is made directly in the database for one fresh user;
// the stub providers (e2e/stub-providers.ts) answer the discover requests, and
// the stub genre "recs-down" makes every provider's discover request fail.
// Every title here is invented.

const APP = "http://localhost:3100";
// Rows wait on providers, and a book row on Hardcover's shared 1 s spacing.
const SLOW = { timeout: 30_000 };

type Account = { state: Awaited<ReturnType<BrowserContext["storageState"]>>; userId: string };

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
      const { data, error } = await adminClient().from("profiles").select("id").eq("username", username).single();
      if (error) throw error;
      await provide({ state, userId: data.id });
    },
    { scope: "worker" },
  ],
  storageState: async ({ account }, provide) => provide(account.state),
});
// The tests build on one library, in order.
test.describe.configure({ mode: "serial" });

// Poster URLs point at the real image CDNs; never let the browser fetch them.
test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/(image\.tmdb\.org|images\.igdb\.com|assets\.hardcover\.app)\//, (route) => route.abort());
});

type Seed = { provider: "tmdb" | "igdb" | "hardcover"; media_type: "movie" | "game" | "book"; provider_id: string; title: string; genres: string[] };

let nextId = 70_000_000 + Math.floor(Math.random() * 9_000_000);

/** Catalogue items in the user's library (Up next), made with the service role. */
async function seed(userId: string, items: Seed[]) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("items")
    .upsert(items, { onConflict: "provider,media_type,provider_id" })
    .select("id, media_type");
  if (error) throw error;
  const entries = data.map((i) => ({
    user_id: userId,
    item_id: i.id,
    item_media_type: i.media_type as "movie" | "game" | "book",
    ...(i.media_type === "book" ? { book_version: "print" as const } : {}),
  }));
  const { error: entriesError } = await admin.from("library_entries").insert(entries);
  if (entriesError) throw entriesError;
}

const movie = (title: string, genres: string[], provider_id = String(nextId++)): Seed => ({
  provider: "tmdb",
  media_type: "movie",
  provider_id,
  title,
  genres,
});

const row = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const card = (page: Page, title: string, scope: Page | Locator = page) =>
  scope.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) });
const rowTitles = (page: Page) => page.getByRole("heading", { level: 2, name: /you might like$/ });

test("signed-out visitors to settings are sent to sign in", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/settings");
  await expect(page).toHaveURL("/login");
  await context.close();
});

test("with an empty library and no pins, one line says what to do", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByText("Add a few things and we'll suggest more like them.")).toBeVisible();
  await expect(page.getByText("Type a title to search.")).toBeVisible();
  await expect(rowTitles(page)).toHaveCount(0);
});

test("a library of horror films suggests horror films, never ones already owned, each with Add", async ({ page, account }) => {
  // 9301 (Hollow Bell) is one of the stub's discover results, and already owned.
  await seed(account.userId, [
    movie("Hollow Bell", ["Horror"], "9301"),
    movie("Invented Creak House", ["Horror", "Comedy"]),
    movie("Invented Drowned Chapel", ["Horror"]),
  ]);

  await page.goto("/search");
  const horror = row(page, "Horror films you might like");
  await expect(horror).toBeVisible(SLOW);
  await expect(page.getByText("Add a few things and we'll suggest more like them.")).toHaveCount(0);

  // Twelve stub results, one owned: ten are shown.
  const cards = horror.getByRole("listitem");
  await expect(cards).toHaveCount(10);
  await expect(card(page, "Hollow Bell")).toHaveCount(0);
  for (const c of await cards.all()) await expect(c.getByRole("button", { name: "Add" })).toBeVisible();

  // The second row is the next genre: Comedy, from one film.
  await expect(rowTitles(page)).toHaveText(["Horror films you might like", "Comedy films you might like"]);

  // Add works from a row like from a search result, and the film then leaves the row.
  // (The stub answers every genre alike, so the Comedy row holds the same films.)
  await card(page, "Wicker Stair", horror).getByRole("button", { name: "Add" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/search" && url.searchParams.get("added") === "1");
  await expect(horror.getByRole("listitem")).toHaveCount(10, SLOW);
  await expect(card(page, "Wicker Stair")).toHaveCount(0);
  const { data } = await adminClient()
    .from("library_entries")
    .select("items!inner(provider_id)")
    .eq("user_id", account.userId)
    .eq("items.provider_id", "9302");
  expect(data).toHaveLength(1);
});

test("a genre pinned in settings comes first; Remove takes it away", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  const tv = row(page, "TV");
  await tv.getByLabel("TV genre").selectOption("Comedy");
  await tv.getByRole("button", { name: "Add" }).click();
  await expect(tv.getByRole("button", { name: "Remove Comedy" })).toBeVisible();
  // A pinned genre isn't offered again.
  await expect(tv.getByLabel("TV genre").locator("option", { hasText: "Comedy" })).toHaveCount(0);

  await page.goto("/search");
  await expect(row(page, "Comedy TV you might like")).toBeVisible(SLOW);
  await expect(rowTitles(page).first()).toHaveText("Comedy TV you might like");
  await expect(card(page, "Brass Neighbours")).toBeVisible();

  await page.goto("/settings");
  await row(page, "TV").getByRole("button", { name: "Remove Comedy" }).click();
  await expect(row(page, "TV").getByRole("button", { name: "Remove Comedy" })).toHaveCount(0);
  await expect(row(page, "TV").getByLabel("TV genre").locator("option", { hasText: "Comedy" })).toHaveCount(1);
});

test("rows whose provider fails are simply absent, and search still works", async ({ page, account }) => {
  await seed(account.userId, [
    movie("Invented Broken Reel", ["recs-down"]),
    { provider: "igdb", media_type: "game", provider_id: String(nextId++), title: "Invented Broken Cog", genres: ["recs-down"] },
    { provider: "hardcover", media_type: "book", provider_id: String(nextId++), title: "Invented Broken Spine", genres: ["recs-down"] },
  ]);
  // Movies already have two busier genres, so the failing film genre comes as a pin, first in line.
  const pin = await adminClient().from("user_genre_pins").insert({ user_id: account.userId, media_type: "movie", genre: "recs-down" });
  if (pin.error) throw pin.error;

  await page.goto("/search");
  await expect(row(page, "Horror films you might like")).toBeVisible(SLOW);
  // Wait until every row has settled, then: the failing ones never appeared.
  await expect(page.locator("[data-recs-loading]")).toHaveCount(0, SLOW);
  await expect(page.getByRole("heading", { name: /recs-down/ })).toHaveCount(0);
  // No provider notice either: those are for a search.
  await expect(page.getByText(/^Couldn.t reach/)).toHaveCount(0);

  await page.getByLabel("Search movies, TV, games and books").fill("Kestrel");
  await expect(card(page, "Kestrel Morning")).toBeVisible();
  // Rows are only for an empty box.
  await expect(rowTitles(page)).toHaveCount(0);
});
