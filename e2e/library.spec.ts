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

/** A status group on /library, such as "Backlog". */
function group(page: Page, status: string) {
  return page.getByRole("region", { name: status, exact: true });
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
  const groups = page.getByRole("region");
  await expect(groups).toHaveCount(1);
  const backlog = group(page, "Backlog");

  const movie = row(backlog, "Kestrel Morning");
  await expect(movie).toContainText("Movie");
  await expect(movie).toContainText("Time to finish: 1 h 44 min");
  await expect(movie).toContainText("Score 71/100 (321 votes)");
  await expect(movie.getByRole("combobox", { name: "Status" })).toHaveValue("backlog");

  // Seasons sit under their show; specials and season 3 aren't added but season 3 counts.
  const show = row(backlog, "Harbour of Glass");
  await expect(show).toContainText("TV");
  await expect(show).toContainText("0 of 3 seasons finished");
  await expect(show).toContainText("Score 82/100 (140 votes)");
  await expect(show.getByRole("heading", { level: 4 })).toHaveText([
    "Season 1 · 8 episodes · 2021",
    "Season 2 · 8 episodes · 2022",
  ]);
  await expect(seasonRow(show, "Season 1 · 8 episodes · 2021")).toContainText("Time to finish: 1 h 38 min");
  await expect(seasonRow(show, "Season 2 · 8 episodes · 2022")).toContainText("Time to finish: 52 min");

  // Finish season 1: it moves to Finished under its show, and progress reads 1 of 3.
  await seasonRow(show, "Season 1 · 8 episodes · 2021").getByRole("combobox", { name: "Status" }).selectOption("Finished");
  const finished = group(page, "Finished");
  const finishedShow = row(finished, "Harbour of Glass");
  await expect(finishedShow).toContainText("1 of 3 seasons finished");
  await expect(seasonRow(finishedShow, "Season 1 · 8 episodes · 2021").getByRole("combobox", { name: "Status" })).toHaveValue(
    "finished",
  );
  await expect(row(backlog, "Harbour of Glass")).toContainText("1 of 3 seasons finished");
  await expect(seasonRow(row(backlog, "Harbour of Glass"), "Season 1 · 8 episodes · 2021")).toHaveCount(0);
  // Groups run In progress, Backlog, Paused, Finished, Dropped, and empty ones are left out.
  await expect(groups.getByRole("heading", { level: 2 })).toHaveText(["Backlog", "Finished"]);

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
  const game = row(group(page, "Backlog"), "Clockwork Lighthouse");
  await expect(game).toContainText("Game");
  await expect(game).toContainText("Time to beat: 12 h (story)");
  await expect(game).toContainText("Score 82/100 (44 votes)");

  // In progress comes first.
  await game.getByRole("combobox", { name: "Status" }).selectOption("In progress");
  await expect(page.getByRole("region").first().getByRole("heading", { level: 2 })).toHaveText("In progress");
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
  const show = row(group(page, "Backlog"), "Saltmarsh Specials");
  await expect(show).toContainText("No seasons yet");
  await expect(show).toContainText("No score");
  await expect(seasonRow(show, "Specials")).toContainText("Time to finish: unknown");
});
