import { randomBytes, randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

// An axe scan of every main page at phone and desktop width, plus two checks
// that a scan can't make: the phone's bottom bar never covers the last control,
// and reduced motion turns transitions off. Rows are made directly in the
// database for a fresh user; every title is invented and unique to this file.

const APP = "http://localhost:3100";

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
test.describe.configure({ mode: "serial" });

// Poster URLs point at the real image CDNs; never let the browser fetch them.
test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/(image\.tmdb\.org|images\.igdb\.com)\//, (route) => route.abort());
});

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

const MOVIE_QUEUED = "Fenwick Lantern";
const MOVIE_SECOND = "Orrin Hollow";
const GAME_QUEUED = "Vesper Quarry";
const SHOW = "Thistle Gantry";
const BUSY = "Larch Meridian";
const FUTURE_MOVIE = "Opal Causeway";
const FINISHED = "Sedge Almanac";

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
      movie(MOVIE_QUEUED, 100),
      movie(MOVIE_SECOND, 90),
      movie(BUSY, 95),
      movie(FUTURE_MOVIE, null, day(20)),
      movie(FINISHED, 80),
      { provider: "igdb", media_type: "game", provider_id: id(), title: GAME_QUEUED },
      { provider: "tmdb", media_type: "show", provider_id: id(), title: SHOW },
    ])
    .select("id, title");
  if (error) throw error;
  const item = Object.fromEntries(items.map((i) => [i.title, i.id]));
  const { data: seasons, error: seasonError } = await admin
    .from("seasons")
    .insert([
      { show_id: item[SHOW], season_number: 1, episode_count: 8, runtime_minutes: 360, air_date: day(-100) },
      { show_id: item[SHOW], season_number: 2, episode_count: 8, runtime_minutes: 360, air_date: day(5) },
    ])
    .select("id, season_number");
  if (seasonError) throw seasonError;
  const season = (n: number) => seasons.find((s) => s.season_number === n)!.id;

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
      entry(MOVIE_QUEUED, "movie", { up_next_position: 1 }),
      entry(MOVIE_SECOND, "movie", { up_next_position: 2 }),
      entry(GAME_QUEUED, "game", { up_next_position: 1 }),
      entry(BUSY, "movie", { status: "in_progress" }),
      entry(FUTURE_MOVIE, "movie"),
      entry(FINISHED, "movie", { status: "finished" }),
      { user_id: userId, season_id: season(1), status: "backlog" as const, up_next_position: 1 },
      { user_id: userId, season_id: season(2), status: "backlog" as const },
    ])
    .select("id, item_id");
  if (entriesError) throw entriesError;
  // Only the service role can write finished_at.
  const finished = entries.find((e) => e.item_id === item[FINISHED])!;
  const { error: stampError } = await admin
    .from("library_entries")
    .update({ finished_at: new Date(Date.now() - 864e5).toISOString() })
    .eq("id", finished.id);
  if (stampError) throw stampError;
  // A pinned genre, so /settings has a Remove and an empty search has a recommendation row.
  const { error: pinError } = await admin.from("user_genre_pins").insert({ user_id: userId, media_type: "movie", genre: "Horror" });
  if (pinError) throw pinError;
}

const SIZES = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
}

for (const size of SIZES) {
  test(`signed-out home and sign-in have no axe violations at ${size.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: APP,
      viewport: { width: size.width, height: size.height },
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "upnext" })).toBeVisible();
    await scan(page);
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await scan(page);
    await context.close();
  });
}

test("seed the library", async ({ account }) => {
  await seedLibrary(account.userId);
});

for (const size of SIZES) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test(`home, signed in with every section, has no axe violations at ${size.name}`, async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("region", { name: "Recently finished" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Release radar" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Currently on" })).toBeVisible();
      await scan(page);
    });

    test(`home on a type tab has no axe violations at ${size.name}`, async ({ page }) => {
      await page.goto("/?type=game");
      await expect(page.getByRole("link", { name: /^Games \(\d+\)$/ })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("region", { name: "Games", exact: true })).toBeVisible();
      await scan(page);
      await page.goto("/?type=book");
      await expect(page.getByText("Nothing here yet.")).toBeVisible();
      await scan(page);
    });

    test(`search results have no axe violations at ${size.name}`, async ({ page }) => {
      const term = `lantern ${randomBytes(3).toString("hex")}`;
      await page.goto(`/search?q=${encodeURIComponent(term)}`);
      await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible();
      await scan(page);
    });

    test(`an empty search with recommendation rows has no axe violations at ${size.name}`, async ({ page }) => {
      await page.goto("/search");
      await expect(page.getByRole("region", { name: "Horror films you might like" })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-recs-loading]")).toHaveCount(0, { timeout: 30_000 });
      await scan(page);
      // The row scrolls inside itself; the page never scrolls sideways.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test(`settings has no axe violations at ${size.name}`, async ({ page }) => {
      await page.goto("/settings");
      await expect(page.getByRole("button", { name: "Remove Horror" })).toBeVisible();
      await scan(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test(`the season picker has no axe violations at ${size.name}`, async ({ page }) => {
      await page.goto("/search/show/9101");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await scan(page);
    });

    test(`my library with all three queues has no axe violations at ${size.name}`, async ({ page }) => {
      await page.goto("/library");
      for (const label of ["Movies", "TV", "Games"]) {
        await expect(page.getByRole("list", { name: `${label} up next`, exact: true })).toBeVisible();
      }
      await scan(page);
    });

    test(`my library on a type tab has no axe violations at ${size.name}`, async ({ page }) => {
      await page.goto("/library?type=game");
      await expect(page.getByRole("link", { name: /^Games \(\d+\)$/ })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("list", { name: "Games up next", exact: true })).toBeVisible();
      await scan(page);
      await page.goto("/library?type=book");
      await expect(page.getByText("Nothing here yet.")).toBeVisible();
      await scan(page);
    });

    test(`credits has no axe violations at ${size.name}`, async ({ page }) => {
      await page.goto("/credits");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await scan(page);
      // A short page fits the viewport: the sidebar must not add a phantom scroll below the header.
      if (size.name === "1280") {
        const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        expect(scrollHeight).toBeLessThanOrEqual(size.height);
      }
    });
  });
}

test.describe("desktop sidebar", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the nav sits in the row beside the content, with no phantom scroll", async ({ page }) => {
    await page.goto("/credits");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    const result = await page.evaluate(() => {
      const navEl = document.querySelector("nav[aria-label='Main']")!;
      const main = document.querySelector("main")!;
      return {
        position: getComputedStyle(navEl).position,
        navRight: navEl.getBoundingClientRect().right,
        mainLeft: main.getBoundingClientRect().left,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    expect(result.position).not.toBe("fixed");
    expect(result.mainLeft).toBeGreaterThanOrEqual(result.navRight);
    expect(result.scrollHeight).toBeLessThanOrEqual(800);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the bottom bar never covers the last control", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByRole("list", { name: "Games up next", exact: true })).toBeVisible();
    const result = await page.evaluate(() => {
      // The last control on the page outside the bar: the footer's Credits link sits after `main`,
      // so it is what the bar would cover first.
      const focusable = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.closest("nav") && el.getClientRects().length > 0);
      const last = focusable[focusable.length - 1];
      last.focus();
      // The worst case: scrolled as far down as the page goes, where the bar sits over whatever is last.
      window.scrollTo(0, document.documentElement.scrollHeight);
      const box = last.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        focused: document.activeElement === last,
        hit: !!top && (top === last || last.contains(top)),
        inNav: !!top?.closest("nav"),
      };
    });
    expect(result.focused).toBe(true);
    expect(result.inNav).toBe(false);
    expect(result.hit).toBe(true);
  });
});

test("reduced motion turns transitions off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const card = page.getByRole("region", { name: "Movies" }).getByRole("listitem").first();
  await expect(card).toBeVisible();
  const durations = (el: Element) =>
    [el, ...el.querySelectorAll("*")].map((e) => getComputedStyle(e).transitionDuration);
  const off = await card.evaluate(durations);
  expect(off.every((d) => d.split(",").every((x) => x.trim() === "0s"))).toBe(true);
  // Without the preference the card does animate, so the check above means something.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const on = await card.evaluate(durations);
  expect(on.some((d) => d.split(",").some((x) => x.trim() !== "0s"))).toBe(true);
});
