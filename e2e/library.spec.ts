import { randomInt } from "node:crypto";
import { expect, test as base, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

const APP = "http://localhost:3100";

type Account = { state: Awaited<ReturnType<BrowserContext["storageState"]>>; username: string };

// A fresh user per run (so the library starts empty), signed in once per worker
// (local Auth rate-limits sign-in emails). Every test here runs in that one
// worker, in order, and each uses its own titles from e2e/fixtures/.
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

async function search(page: Page, term: string) {
  await page.getByLabel("Search movies, TV and games").fill(term);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/[?&]q=/);
}

function result(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

/** A status group on /library, such as "Finished". */
function group(page: Page, status: string) {
  return page.getByRole("region", { name: status, exact: true });
}

/** One type's Up next queue on /library, such as "Movies". */
function queue(page: Page, label: string) {
  return page.getByRole("list", { name: `${label} up next`, exact: true });
}

/** A row in an Up next queue, by its title ("Show · Season 1" for a season). */
function queued(list: Locator, title: string) {
  return list.getByRole("listitem").filter({ has: list.page().getByRole("heading", { level: 4, name: title, exact: true }) });
}

/** A movie, game or show row in a group. */
function row(scope: Locator, title: string) {
  return scope.getByRole("listitem").filter({ has: scope.page().getByRole("heading", { level: 3, name: title, exact: true }) });
}

/** A season row under its show. */
function seasonRow(show: Locator, label: string) {
  return show.getByRole("listitem").filter({ has: show.page().getByRole("heading", { level: 4, name: label, exact: true }) });
}

async function userId(username: string): Promise<string> {
  const { data, error } = await adminClient().from("profiles").select("id").eq("username", username).single();
  if (error) throw error;
  return data.id;
}

test("signed-out visitors are sent to sign in", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/library");
  await expect(page).toHaveURL("/login");
  await context.close();
});

test("add a movie and two seasons, then finish a season", async ({ page }) => {
  // A fresh user's library is empty.
  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 1, name: "My library" })).toBeVisible();
  await expect(page.getByText("Nothing here yet. Search to add something.")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Search", exact: true })).toHaveAttribute(
    "href",
    "/search",
  );

  // Search with games hidden, add the movie.
  await page.goto("/search");
  await page.getByRole("checkbox", { name: "Games" }).check();
  await search(page, "Kestrel");
  await expect(result(page, "Clockwork Lighthouse")).toHaveCount(0);
  await result(page, "Kestrel Morning").getByRole("button", { name: "Add" }).click();
  await expect(result(page, "Kestrel Morning").getByRole("button", { name: "In your library" })).toBeVisible();

  // Add seasons 1 and 2 of the show.
  await result(page, "Harbour of Glass").getByRole("link", { name: "Choose seasons" }).click();
  await page.getByRole("checkbox", { name: "Season 1 · 8 episodes · 2021", exact: true }).check();
  await page.getByRole("checkbox", { name: "Season 2 · 8 episodes · 2022", exact: true }).check();
  await page.getByRole("button", { name: "Add seasons" }).click();
  await expect(page).toHaveURL("/search/show/9101?added=1");

  await page.goto("/library");
  await expect(page).toHaveTitle("My library · upnext");
  await expect(page.getByText("Nothing here yet.")).toHaveCount(0);
  // Up next holds everything added; no status group yet.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Up next"]);

  const movie = queued(queue(page, "Movies"), "Kestrel Morning");
  await expect(movie).toContainText("Movie");
  await expect(movie).toContainText("Time to finish: 1 h 44 min");
  await expect(movie).toContainText("Score 71/100 (321 votes)");
  await expect(movie.getByRole("combobox", { name: "Status" })).toHaveValue("backlog");

  // Each season is its own row in the TV queue, in the order added.
  const tv = queue(page, "TV");
  await expect(tv.getByRole("heading", { level: 4 })).toHaveText(["Harbour of Glass · Season 1", "Harbour of Glass · Season 2"]);
  const seasonOne = queued(tv, "Harbour of Glass · Season 1");
  await expect(seasonOne).toContainText("8 episodes · 2021");
  await expect(seasonOne).toContainText("Time to finish: 1 h 38 min");
  await expect(seasonOne).toContainText("Score 82/100 (140 votes)");
  await expect(queued(tv, "Harbour of Glass · Season 2")).toContainText("Time to finish: 52 min");

  // Finish season 1: it moves to Finished under its show, and progress reads 1 of 3
  // (specials and season 3 aren't added, but season 3 counts).
  await seasonOne.getByRole("combobox", { name: "Status" }).selectOption("Finished");
  const finished = group(page, "Finished");
  const finishedShow = row(finished, "Harbour of Glass");
  await expect(finishedShow).toContainText("1 of 3 seasons finished");
  await expect(seasonRow(finishedShow, "Season 1 · 8 episodes · 2021").getByRole("combobox", { name: "Status" })).toHaveValue(
    "finished",
  );
  await expect(tv.getByRole("heading", { level: 4 })).toHaveText(["Harbour of Glass · Season 2"]);
  // Groups run In progress, Paused, Finished, Dropped, and empty ones are left out.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Up next", "Finished"]);

  // It sticks after a reload.
  await page.reload();
  await expect(row(group(page, "Finished"), "Harbour of Glass")).toContainText("1 of 3 seasons finished");
});

test("a game shows its time to beat, and Remove takes it out", async ({ page, account }) => {
  await page.goto("/search");
  await search(page, "Clockwork");
  await result(page, "Clockwork Lighthouse").getByRole("button", { name: "Add" }).click();
  await expect(result(page, "Clockwork Lighthouse").getByRole("button", { name: "In your library" })).toBeVisible();

  await page.goto("/library");
  const game = queued(queue(page, "Games"), "Clockwork Lighthouse");
  await expect(game).toContainText("Game");
  await expect(game).toContainText("Time to beat: 12 h (story)");
  await expect(game).toContainText("Score 82/100 (44 votes)");

  // In progress comes first, before Up next, so a long queue never buries it.
  await game.getByRole("combobox", { name: "Status" }).selectOption("In progress");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["In progress", "Up next", "Finished"]);
  const playing = row(group(page, "In progress"), "Clockwork Lighthouse");
  await expect(playing).toBeVisible();

  await playing.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Clockwork Lighthouse" })).toHaveCount(0);
  await expect(group(page, "In progress")).toHaveCount(0);

  const { data: items } = await adminClient().from("items").select("id").eq("provider", "igdb").eq("provider_id", "7001");
  const { count } = await adminClient()
    .from("library_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", await userId(account.username))
    .in(
      "item_id",
      (items ?? []).map((i) => i.id),
    );
  expect(count).toBe(0);
});

test("a show with only specials reads No seasons yet", async ({ page }) => {
  // Review Focus 5: no seasons numbered 1 or more, no score, no runtimes or dates.
  await page.goto("/search/show/9102");
  await page.getByRole("checkbox", { name: "Specials", exact: true }).check();
  await page.getByRole("button", { name: "Add seasons" }).click();
  await expect(page).toHaveURL("/search/show/9102?added=1");

  await page.goto("/library");
  // A show's progress line shows on its row in a status group, so pause the season.
  const specials = queued(queue(page, "TV"), "Saltmarsh Specials · Specials");
  await expect(specials).toContainText("No score");
  await specials.getByRole("combobox", { name: "Status" }).selectOption("Paused");
  const show = row(group(page, "Paused"), "Saltmarsh Specials");
  await expect(show).toContainText("No seasons yet");
  await expect(show).toContainText("No score");
  await expect(seasonRow(show, "Specials")).toContainText("Time to finish: unknown");
});

test("a double-click on Remove removes the entry once, with no error page", async ({ page, account }) => {
  const label = "Season 3 · 6 episodes · 2024";
  await page.goto("/search/show/9101");
  await page.getByRole("checkbox", { name: label, exact: true }).check();
  await page.getByRole("button", { name: "Add seasons" }).click();
  await expect(page).toHaveURL("/search/show/9101?added=1");

  await page.goto("/library");
  const title = "Harbour of Glass · Season 3";
  const season = queued(queue(page, "TV"), title);
  await expect(season.getByRole("button", { name: "Remove" })).toBeEnabled(); // hydrated
  await season.getByRole("button", { name: "Remove" }).dblclick();

  await expect(page.getByRole("heading", { level: 4, name: title })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "My library" })).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByText(/This page couldn.t load|Application error/)).toHaveCount(0); // Next's default

  const admin = adminClient();
  const { data: show } = await admin
    .from("items")
    .select("id")
    .eq("provider", "tmdb")
    .eq("media_type", "show")
    .eq("provider_id", "9101")
    .single();
  const { data: season3 } = await admin.from("seasons").select("id").eq("show_id", show!.id).eq("season_number", 3).single();
  const { count } = await admin
    .from("library_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", await userId(account.username))
    .eq("season_id", season3!.id);
  expect(count).toBe(0);
});

test("a very long title wraps and never scrolls the page sideways at 390px", async ({ page, account }) => {
  const title = `Quillfeather ${"Moonlit".repeat(6)} and the Unreasonably Extended Chronicle of the Wandering Cartographers Guild`;
  expect(title.length).toBeGreaterThanOrEqual(120);
  const admin = adminClient();
  const { data: item, error } = await admin
    .from("items")
    .insert({ provider: "tmdb", media_type: "movie", provider_id: String(randomInt(10_000_000, 99_999_999)), title })
    .select("id")
    .single();
  if (error) throw error;
  const { error: entryError } = await admin
    .from("library_entries")
    .insert({ user_id: await userId(account.username), item_id: item.id, item_media_type: "movie" });
  if (entryError) throw entryError;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");
  // Added means queued.
  await expect(page.getByRole("list", { name: "Movies up next" }).getByRole("heading", { level: 4, name: title })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});
