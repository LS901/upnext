import { randomInt } from "node:crypto";
import { expect, test as base, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

// Up next: one queue per media type, ordered by the user (owner said, 2026-11-26).
// The catalogue rows and Backlog entries are made directly in the database for a
// fresh user, so these tests need no provider calls; every title is invented and
// unique to this file.

const APP = "http://localhost:3100";

type Account = { state: Awaited<ReturnType<BrowserContext["storageState"]>>; userId: string };

// Signed in once per worker (local Auth rate-limits sign-in emails); the tests
// below run in that one worker, in order, against the same library, so each
// starts where the last left off and a failure skips the rest.
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
      await seedBacklog(data.id);
      await provide({ state, userId: data.id });
    },
    { scope: "worker" },
  ],
  storageState: async ({ account }, provide) => provide(account.state),
});
test.describe.configure({ mode: "serial" });

const MOVIES = ["Kite Ledger", "Lantern Quay", "Moss Archive"];
const GAME = "Nettle Circuit";
const SHOW = "Orchard Signal";

async function seedBacklog(userId: string) {
  const admin = adminClient();
  const id = () => String(randomInt(10_000_000, 99_999_999));
  const { data: items, error } = await admin
    .from("items")
    .insert([
      ...MOVIES.map((title) => ({ provider: "tmdb" as const, media_type: "movie" as const, provider_id: id(), title })),
      { provider: "igdb", media_type: "game", provider_id: id(), title: GAME },
      { provider: "tmdb", media_type: "show", provider_id: id(), title: SHOW },
    ])
    .select("id, media_type");
  if (error) throw error;
  const show = items.find((i) => i.media_type === "show")!;
  const { data: seasons, error: seasonsError } = await admin
    .from("seasons")
    .insert([1, 2].map((n) => ({ show_id: show.id, season_number: n, episode_count: 6 })))
    .select("id");
  if (seasonsError) throw seasonsError;
  const { error: entriesError } = await admin.from("library_entries").insert([
    ...items
      .filter((i) => i.media_type !== "show")
      .map((i) => ({ user_id: userId, item_id: i.id, item_media_type: i.media_type as "movie" | "game" })),
    ...seasons.map((s) => ({ user_id: userId, season_id: s.id })),
  ]);
  if (entriesError) throw entriesError;
}

/** A status group, such as "Backlog". */
const group = (page: Page, status: string) => page.getByRole("region", { name: status, exact: true });

/** One type's queue, such as "Movies". */
const queue = (page: Page, label: string) => page.getByRole("list", { name: `${label} up next`, exact: true });

/** A queued row, by its title. */
const queued = (list: Locator, title: string) =>
  list.getByRole("listitem").filter({ has: list.page().getByRole("heading", { level: 4, name: title, exact: true }) });

/** A movie, game or show row in a status group. */
const row = (scope: Locator, title: string) =>
  scope.getByRole("listitem").filter({ has: scope.page().getByRole("heading", { level: 3, name: title, exact: true }) });

const titles = (list: Locator) => list.getByRole("heading", { level: 4 });

/**
 * One key of a keyboard drag: press it, wait for its screen-reader announcement
 * (dnd-kit's live region), then let dnd-kit settle. It attaches its key listener
 * on the next task after a pick-up and measures the list after the next frame,
 * so a key pressed sooner is lost.
 */
async function dragKey(page: Page, key: string, announcement: string) {
  await page.keyboard.press(key);
  await expect(page.getByRole("status").filter({ hasText: announcement })).toHaveCount(1);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0))));
}

test("each type gets its own queue, in the order you set", async ({ page }) => {
  await page.goto("/library");
  const upNext = page.getByRole("region", { name: "Up next", exact: true });
  for (const label of ["Movies", "TV", "Games"]) {
    await expect(upNext.getByRole("region", { name: label, exact: true })).toContainText(
      "Nothing up next. Add something from your Backlog below.",
    );
  }

  const backlog = group(page, "Backlog");
  for (const title of [...MOVIES, GAME]) {
    await row(backlog, title).getByRole("button", { name: "Add to Up next" }).click();
    await expect(row(backlog, title)).toHaveCount(0);
  }
  const seasonOne = row(backlog, SHOW)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 4, name: "Season 1 · 6 episodes" }) });
  await seasonOne.getByRole("button", { name: "Add to Up next" }).click();

  // Each lands at the bottom of its own type's queue, never another's.
  const movies = queue(page, "Movies");
  await expect(titles(movies)).toHaveText(MOVIES);
  await expect(titles(queue(page, "Games"))).toHaveText([GAME]);
  await expect(titles(queue(page, "TV"))).toHaveText([`${SHOW} · Season 1`]);
  // The heading names the season, so the line below it doesn't repeat it.
  await expect(queue(page, "TV")).toContainText("6 episodes");
  await expect(queue(page, "TV")).not.toContainText("Season 1 · 6 episodes");
  // Season 2 wasn't added, so the show stays under Backlog with just that season.
  await expect(row(backlog, SHOW)).toContainText("Season 2 · 6 episodes");
  await expect(row(backlog, SHOW)).not.toContainText("Season 1");

  // The buttons.
  const [kite, lantern, moss] = MOVIES;
  await queued(movies, moss).getByRole("button", { name: "Move to top" }).click();
  await expect(titles(movies)).toHaveText([moss, kite, lantern]);
  // A double-click moves one place, not two.
  await queued(movies, moss).getByRole("button", { name: "Move down" }).dblclick();
  await expect(titles(movies)).toHaveText([kite, moss, lantern]);

  // Drag and drop, by keyboard. Each key waits for its announcement, which also
  // checks what a screen reader hears. Down one place first: the browser drops
  // focus from an element that's moved, and moving down moves the dragged row.
  const handle = (title: string) => movies.getByRole("button", { name: `Drag to reorder ${title}` });
  await expect(handle(moss)).toBeEnabled();
  await handle(moss).focus();
  // Picking up announces "Picked up …", then at once where it is.
  await dragKey(page, "Space", `${moss} is at position 2 of 3.`);
  await dragKey(page, "ArrowDown", `${moss} moved to position 3 of 3.`);
  await dragKey(page, "Space", `${moss} dropped at position 3 of 3.`);
  await expect(titles(movies)).toHaveText([kite, lantern, moss]);
  await expect(movies).toHaveAttribute("aria-busy", "false");
  await expect(handle(moss)).toBeFocused();

  // Move up by keyboard, twice: focus stays on the button, even once it's
  // disabled at the top.
  const moveUp = queued(movies, moss).getByRole("button", { name: "Move up" });
  await moveUp.focus();
  await page.keyboard.press("Enter");
  await expect(titles(movies)).toHaveText([kite, moss, lantern]);
  await expect(moveUp).toBeFocused();
  await expect(moveUp).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(titles(movies)).toHaveText([moss, kite, lantern]);
  await expect(moveUp).toBeFocused();
  await expect(moveUp).toBeDisabled();
  await expect(queued(movies, lantern).getByRole("button", { name: "Move down" })).toBeDisabled();

  // Up two places, the other way.
  await handle(lantern).focus();
  await dragKey(page, "Space", `${lantern} is at position 3 of 3.`);
  await dragKey(page, "ArrowUp", `${lantern} moved to position 2 of 3.`);
  await dragKey(page, "ArrowUp", `${lantern} moved to position 1 of 3.`);
  await dragKey(page, "Space", `${lantern} dropped at position 1 of 3.`);
  await expect(titles(movies)).toHaveText([lantern, moss, kite]);
  await expect(movies).toHaveAttribute("aria-busy", "false");
  await expect(handle(lantern)).toBeFocused();

  // Saved, not just shown: a reload keeps the order, and the other queues never moved.
  await page.reload();
  await expect(titles(queue(page, "Movies"))).toHaveText([lantern, moss, kite]);
  await expect(titles(queue(page, "Games"))).toHaveText([GAME]);
});

test("a hidden queue stays hidden until you show it again", async ({ page }) => {
  await page.goto("/library");
  const show = page.getByRole("group", { name: "Show" });
  await show.getByRole("checkbox", { name: "Games" }).uncheck();
  await expect(queue(page, "Games")).toHaveCount(0);
  await expect(queue(page, "Movies")).toBeVisible();

  await page.reload();
  await expect(queue(page, "Games")).toHaveCount(0);
  // Hidden, but its count still says what's in it.
  await expect(page.getByRole("group", { name: "Show" }).getByRole("checkbox", { name: "Games (1)" })).not.toBeChecked();

  await page.getByRole("group", { name: "Show" }).getByRole("checkbox", { name: "Games" }).check();
  await expect(titles(queue(page, "Games"))).toHaveText([GAME]);
});

test("Start and Remove from Up next take an entry off its queue", async ({ page }) => {
  await page.goto("/library");
  const movies = queue(page, "Movies");
  const [kite, lantern, moss] = MOVIES;
  await expect(titles(movies)).toHaveText([lantern, moss, kite]);

  await queued(movies, lantern).getByRole("button", { name: "Start" }).click();
  await expect(titles(movies)).toHaveText([moss, kite]);
  const playing = row(group(page, "In progress"), lantern);
  await expect(playing).toBeVisible();
  // Only Backlog entries can be queued.
  await expect(playing.getByRole("button", { name: "Add to Up next" })).toHaveCount(0);

  await queued(movies, moss).getByRole("button", { name: "Remove from Up next" }).click();
  await expect(titles(movies)).toHaveText([kite]);
  await expect(row(group(page, "Backlog"), moss).getByRole("button", { name: "Add to Up next" })).toBeVisible();

  // Back in, it goes to the bottom. Focus left in the queue earlier, then
  // clicked away from, isn't pulled back when the queue changes.
  const kiteToTop = queued(movies, kite).getByRole("button", { name: "Move to top" });
  await kiteToTop.focus();
  await page.getByRole("heading", { level: 1, name: "My library" }).click();
  await row(group(page, "Backlog"), moss).getByRole("button", { name: "Add to Up next" }).click();
  await expect(titles(movies)).toHaveText([kite, moss]);
  await expect(kiteToTop).not.toBeFocused();
});
