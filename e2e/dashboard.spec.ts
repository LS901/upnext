import { randomInt } from "node:crypto";
import { expect, test as base, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

// Home: the landing page for visitors and the dashboard for signed-in users.
// Rows are made directly in the database for a fresh user, so no provider is
// called; every title is invented and unique to this file.

const APP = "http://localhost:3100";

type Account = { state: Awaited<ReturnType<BrowserContext["storageState"]>>; userId: string };

// Signed in once per worker (local Auth rate-limits sign-in emails). It doesn't
// seed: the first signed-in test needs the new-user state. The tests run in
// order against the same library, so a failure skips the rest.
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
test.describe.configure({ mode: "serial" });

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

const QUEUED = "Wren Harbour";
const SECOND = "Tarn Meridian";
const UNTIMED = "Ember Causeway";
const LONG_GAME =
  "Quillfeather Observatory of the Thousand Lanterns and the Wandering Cartographers Who Mapped the Silent Orchard Beyond";
const FUTURE_MOVIE = "Sable Regatta";
const FUTURE_SHOW = "Pale Lantern Row";
const PAST_MOVIE = "Dusk Almanac";
const BUSY = "Cobalt Orchard";
const FINISHED_A = "Birch Telegraph";
const FINISHED_B = "Halcyon Mortar";

async function seedLibrary(userId: string) {
  const admin = adminClient();
  const id = () => String(randomInt(10_000_000, 99_999_999));
  const movie = (title: string, runtime_minutes: number | null, release_date: string | null = null) => ({
    provider: "tmdb" as const,
    media_type: "movie" as const,
    provider_id: id(),
    title,
    runtime_minutes,
    release_date,
  });
  const { data: items, error } = await admin
    .from("items")
    .insert([
      movie(QUEUED, 100),
      movie(SECOND, 50),
      movie(UNTIMED, null),
      { provider: "igdb", media_type: "game", provider_id: id(), title: LONG_GAME },
      movie(FUTURE_MOVIE, null, day(20)),
      movie(PAST_MOVIE, null, day(-30)),
      movie(BUSY, 90),
      movie(FINISHED_A, 80),
      movie(FINISHED_B, 85),
      { provider: "tmdb", media_type: "show", provider_id: id(), title: FUTURE_SHOW },
    ])
    .select("id, title");
  if (error) throw error;
  const item = Object.fromEntries(items.map((i) => [i.title, i.id]));
  const { data: seasons, error: seasonError } = await admin
    .from("seasons")
    .insert([{ show_id: item[FUTURE_SHOW], season_number: 2, episode_count: 8, air_date: day(5) }])
    .select("id");
  if (seasonError) throw seasonError;

  const entry = (title: string, type: "movie" | "game", extra: object = {}) => ({
    user_id: userId,
    item_id: item[title],
    item_media_type: type,
    status: "backlog" as "backlog" | "in_progress" | "finished",
    up_next_position: null as number | null,
    ...extra,
  });
  const { data: entries, error: entriesError } = await admin
    .from("library_entries")
    .insert([
      entry(QUEUED, "movie", { up_next_position: 1 }),
      entry(SECOND, "movie"),
      entry(UNTIMED, "movie"),
      entry(LONG_GAME, "game", { up_next_position: 1 }),
      entry(FUTURE_MOVIE, "movie"),
      entry(PAST_MOVIE, "movie"),
      entry(BUSY, "movie", { status: "in_progress" }),
      entry(FINISHED_A, "movie", { status: "finished" }),
      entry(FINISHED_B, "movie", { status: "finished" }),
      { user_id: userId, season_id: seasons[0].id, status: "backlog" as const },
    ])
    .select("id, item_id");
  if (entriesError) throw entriesError;
  // Only the service role can write finished_at: B is the newer.
  for (const [title, ago] of [
    [FINISHED_A, 3],
    [FINISHED_B, 1],
  ] as const) {
    const finished = entries.find((e) => e.item_id === item[title])!;
    const { error: stampError } = await admin
      .from("library_entries")
      .update({ finished_at: new Date(Date.now() - ago * 864e5).toISOString() })
      .eq("id", finished.id);
    if (stampError) throw stampError;
  }
}

const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const rows = (scope: Locator) => scope.getByRole("listitem");

test("a signed-out visitor sees the landing page", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "upnext" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("heading", { name: "Release radar" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Currently on" })).toHaveCount(0);
  await expect(page.getByText("Keep everything you want to get to in one place, in the order you'll get to it.")).toBeVisible();
  await expect(page.getByText("Backlog")).toHaveCount(0);
  await context.close();
});

test("a new user sees one empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByText("Nothing in your library yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Search to add something" })).toHaveAttribute("href", "/search");
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
});

test("the dashboard shows your numbers, what you're on, Up next, the radar and recently finished", async ({
  page,
  account,
}) => {
  await seedLibrary(account.userId);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const numbers = section(page, "Your numbers");
  await expect(numbers).toContainText(/7\s*Up next/);
  await expect(numbers).not.toContainText("Backlog");
  await expect(page.getByText("Backlog")).toHaveCount(0);
  await expect(numbers).toContainText("about 3 h to finish");
  await expect(numbers).toContainText(/1\s*In progress/);
  await expect(numbers).toContainText(/2\s*Finished/);

  await expect(rows(section(page, "Currently on"))).toHaveText([new RegExp(BUSY)]);

  // Every not-started movie is queued; the card shows the top of the queue.
  const movies = section(page, "Movies");
  await expect(movies).toContainText(QUEUED);
  await expect(rows(movies).filter({ hasText: QUEUED }).getByRole("button", { name: "Start" })).toBeVisible();
  await expect(movies.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/library#up-next");
  await expect(section(page, "Games")).toContainText(LONG_GAME);

  const radar = section(page, "Release radar");
  await expect(rows(radar)).toHaveCount(2);
  await expect(rows(radar).nth(0)).toContainText(`${FUTURE_SHOW} · Season 2`);
  await expect(rows(radar).nth(0)).toContainText("in 5 days");
  await expect(rows(radar).nth(1)).toContainText(FUTURE_MOVIE);
  await expect(rows(radar).nth(1)).toContainText("in 20 days");
  await expect(radar).not.toContainText(PAST_MOVIE);

  const finished = section(page, "Recently finished");
  await expect(rows(finished)).toHaveCount(2);
  await expect(rows(finished).nth(0)).toContainText(FINISHED_B);
  await expect(rows(finished).nth(1)).toContainText(FINISHED_A);
  await expect(rows(finished).nth(0)).toContainText("Finished");

  // A 120-character title wraps; it never makes the page scroll sideways.
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("a queue hidden in My library is hidden here too", async ({ page }) => {
  await page.goto("/library");
  const movies = () => page.getByRole("group", { name: "Show" }).getByRole("checkbox", { name: /^Movies/ });
  await movies().uncheck();
  await expect(movies()).not.toBeChecked();
  // The queue leaving My library shows the choice is saved.
  await expect(page.getByRole("list", { name: "Movies up next", exact: true })).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Up next", exact: true })).toBeVisible();
  await expect(section(page, "Movies")).toHaveCount(0);
  await expect(section(page, "Games")).toBeVisible();

  await page.goto("/library");
  await movies().check();
  await expect(movies()).toBeChecked();
  await expect(page.getByRole("list", { name: "Movies up next", exact: true })).toBeVisible();
});

test("Start on the dashboard moves an entry to In progress", async ({ page }) => {
  await page.goto("/");
  await rows(section(page, "Movies")).filter({ hasText: QUEUED }).getByRole("button", { name: "Start" }).click();
  await expect(section(page, "Movies")).not.toContainText(QUEUED);
  const current = rows(section(page, "Currently on"));
  await expect(current).toHaveCount(2);
  await expect(current.filter({ hasText: QUEUED })).toHaveCount(1);
});

test("books show on the Up next tile as pages, and in a Books Up next card, the radar and Currently on", async ({
  page,
  account,
}) => {
  const admin = adminClient();
  const id = () => String(randomInt(10_000_000, 99_999_999));
  const PRINT = "Marrow Lantern Atlas";
  const AUDIO = "Quiet Tern Archive";
  const SOON = "Vesper Ledger";
  const book = (title: string, extra: object) => ({
    provider: "hardcover" as const,
    media_type: "book" as const,
    provider_id: id(),
    title,
    ...extra,
  });
  const { data: items, error } = await admin
    .from("items")
    .insert([
      book(PRINT, { page_count: 1240 }),
      book(AUDIO, { audio_minutes: 600 }),
      book(SOON, { audio_minutes: 120, release_date: day(9) }),
    ])
    .select("id, title");
  if (error) throw error;
  const item = Object.fromEntries(items.map((i) => [i.title, i.id]));
  const entry = (title: string, version: "print" | "audio", status: "backlog" | "in_progress" = "backlog") => ({
    user_id: account.userId,
    item_id: item[title],
    item_media_type: "book" as const,
    book_version: version,
    status,
  });
  const { error: entriesError } = await admin
    .from("library_entries")
    .insert([entry(PRINT, "print"), entry(AUDIO, "audio"), entry(SOON, "audio")]);
  if (entriesError) throw entriesError;

  await page.goto("/");
  await expect(section(page, "Your numbers")).toContainText("1,240 pages to read");
  await expect(section(page, "Your numbers")).toContainText(/about \d+ h to finish/);
  const books = section(page, "Books");
  await expect(rows(books)).toHaveCount(3);
  await expect(rows(books).filter({ hasText: PRINT })).not.toContainText("Audiobook");
  await expect(rows(books).filter({ hasText: `${AUDIO} · Audiobook` })).toHaveCount(1);
  const radar = section(page, "Release radar");
  await expect(rows(radar).filter({ hasText: `${SOON} · Audiobook` })).toContainText("Book");

  await rows(books).filter({ hasText: AUDIO }).getByRole("button", { name: "Start" }).click();
  await expect(rows(section(page, "Currently on")).filter({ hasText: `${AUDIO} · Audiobook` })).toHaveCount(1);
});
