import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { expect, test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

// Sharing: user A makes a public list and writes a note; user B (and a signed-out
// visitor) sees A's library and list but never the note or A's email (INV-002,
// INV-009); A's privacy switch makes the profile answer exactly as an unknown
// username does. Two sign-ins per worker; every title is invented and unique to this file.

const APP = "http://localhost:3100";

type Account = {
  state: Awaited<ReturnType<BrowserContext["storageState"]>>;
  userId: string;
  username: string;
  email: string;
};

async function signIn(browser: Browser): Promise<Account> {
  const context = await browser.newContext({ baseURL: APP });
  const page = await context.newPage();
  const email = newEmail();
  await signInByLink(page, email, email);
  const username = (await usernameInHeader(page).textContent())!;
  const state = await context.storageState();
  await context.close();
  const { data, error } = await adminClient().from("profiles").select("id").eq("username", username).single();
  if (error) throw error;
  return { state, userId: data.id, username, email };
}

const test = base.extend<object, { a: Account; b: Account }>({
  a: [async ({ browser }, provide) => provide(await signIn(browser)), { scope: "worker" }],
  b: [async ({ browser }, provide) => provide(await signIn(browser)), { scope: "worker" }],
  storageState: async ({ a }, provide) => provide(a.state),
});
// The tests build on one library and one list, in order.
test.describe.configure({ mode: "serial" });

// Poster URLs point at the real image CDNs; never let the browser fetch them.
test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/(image\.tmdb\.org|images\.igdb\.com)\//, (route) => route.abort());
});

const suffix = randomBytes(3).toString("hex");
const FINISHED = `Invented Gourd Vigil ${suffix}`;
const QUEUED = `Invented Marrow Night ${suffix}`;
const LIST = "Invented Halloween 2026";
const NOTE = `Invented private note ${suffix}: the ending was the best part`;
const PRIVATE_OR_MISSING = "This library is private or doesn't exist.";
const LIST_MISSING = "This list is private or doesn't exist.";

let listId = "";

async function as(browser: Browser, account: Account | null, width = 1280) {
  const context = await browser.newContext({
    baseURL: APP,
    viewport: { width, height: 844 },
    storageState: account ? account.state : { cookies: [], origins: [] },
  });
  await context.route(/^https:\/\/(image\.tmdb\.org|images\.igdb\.com)\//, (route) => route.abort());
  return { context, page: await context.newPage() };
}

function libraryRow(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

// What another person could read: the page's HTML, which must never hold the note or the email.
async function expectNothingPrivate(page: Page, owner: Account) {
  const html = await page.content();
  expect(html).not.toContain(NOTE);
  expect(html).not.toContain(owner.email);
  expect(html).not.toContain(owner.email.split("@")[0]);
}

async function libraryPrivate(account: Account) {
  const { data, error } = await adminClient().from("profiles").select("library_private").eq("id", account.userId).single();
  if (error) throw error;
  return data.library_private;
}

test("seed A's library", async ({ a }) => {
  const admin = adminClient();
  const id = () => String(randomInt(10_000_000, 99_999_999));
  const { data: items, error } = await admin
    .from("items")
    .insert([
      { provider: "tmdb", media_type: "movie", provider_id: id(), title: FINISHED, runtime_minutes: 95 },
      { provider: "tmdb", media_type: "movie", provider_id: id(), title: QUEUED, runtime_minutes: 101 },
    ])
    .select("id, title");
  if (error) throw error;
  const item = Object.fromEntries(items.map((i) => [i.title, i.id]));
  const { error: entryError } = await admin.from("library_entries").insert([
    { user_id: a.userId, item_id: item[FINISHED], item_media_type: "movie", status: "finished" },
    { user_id: a.userId, item_id: item[QUEUED], item_media_type: "movie", status: "backlog" },
  ]);
  if (entryError) throw entryError;
});

test("A makes a public list with two entries and writes a note", async ({ page, a }) => {
  await page.goto("/lists");
  await expect(page.getByRole("heading", { level: 1, name: "Lists" })).toBeVisible();
  await page.getByLabel("List name").fill(LIST);
  await page.getByRole("button", { name: "Create list" }).click();
  const link = page.getByRole("link", { name: LIST, exact: true });
  await expect(link).toBeVisible();
  listId = (await link.getAttribute("href"))!.split("/").pop()!;
  expect(listId).toMatch(/^[0-9a-f-]{36}$/);

  // Add to list from My library, for both entries; a double-click adds once.
  await page.goto("/library");
  for (const title of [FINISHED, QUEUED]) {
    const row = libraryRow(page, title);
    await row.getByLabel(`Add ${title} to a list`).selectOption({ label: LIST });
    await row.getByRole("button", { name: "Add to list" }).dblclick();
    await expect(row.getByText(`On ${LIST}`)).toBeVisible();
  }
  const { data: rows } = await adminClient().from("list_entries").select("entry_id").eq("list_id", listId);
  expect(rows).toHaveLength(2);

  // The note: a disclosure on the row, saved and kept after a reload.
  const finished = libraryRow(page, FINISHED);
  await finished.locator("summary", { hasText: "Note" }).click();
  await finished.getByLabel(`Note for ${FINISHED}`).fill(NOTE);
  await finished.getByRole("button", { name: "Save note" }).click();
  await page.reload();
  const again = libraryRow(page, FINISHED);
  await again.locator("summary", { hasText: "Note" }).click();
  await expect(again.getByLabel(`Note for ${FINISHED}`)).toHaveValue(NOTE);

  // The list page, for its owner: both entries, in the order added, each removable.
  await page.goto(`/lists/${listId}`);
  await expect(page.getByRole("heading", { level: 1, name: LIST })).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([FINISHED, QUEUED]);
  await expect(page.getByRole("button", { name: `Remove ${FINISHED} from the list` })).toBeVisible();

  // The header's username is a link to A's own profile.
  await page.getByRole("banner").getByRole("link", { name: a.username }).click();
  await expect(page).toHaveURL(`/u/${a.username}`);
  await expect(page.getByRole("heading", { level: 1, name: a.username })).toBeVisible();
});

test("B sees A's library and list, but never the note or A's email", async ({ browser, a, b }) => {
  const { context, page } = await as(browser, b);
  await page.goto(`/u/${a.username}`);
  await expect(page.getByRole("heading", { level: 1, name: a.username })).toBeVisible();
  await expect(page.getByRole("heading", { name: FINISHED, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: QUEUED, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^All \(\d+\)$/ })).toHaveAttribute("aria-current", "page");
  // Read-only: no controls of A's, and no note.
  const main = page.getByRole("main");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByRole("combobox")).toHaveCount(0);
  await expect(main.locator("textarea, summary")).toHaveCount(0);
  await expectNothingPrivate(page, a);

  // A type tab filters, as on My library.
  await page.getByRole("link", { name: /^Games \(\d+\)$/ }).click();
  await expect(page).toHaveURL(`/u/${a.username}?type=game`);
  await expect(page.getByRole("heading", { name: FINISHED, exact: true })).toHaveCount(0);

  // The list, read-only.
  await page.goto(`/u/${a.username}`);
  await page.getByRole("link", { name: LIST, exact: true }).click();
  await expect(page).toHaveURL(`/lists/${listId}`);
  await expect(page.getByRole("heading", { level: 1, name: LIST })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2 })).toHaveText([FINISHED, QUEUED]);
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByRole("link", { name: a.username })).toHaveAttribute("href", `/u/${a.username}`);
  await expectNothingPrivate(page, a);
  await context.close();
});

test("signed out, the profile and the list are readable too, and still without the note or email", async ({ browser, a }) => {
  const { context, page } = await as(browser, null);
  await page.goto(`/u/${a.username}`);
  await expect(page.getByRole("heading", { name: FINISHED, exact: true })).toBeVisible();
  await expectNothingPrivate(page, a);
  await page.goto(`/lists/${listId}`);
  await expect(page.getByRole("heading", { level: 1, name: LIST })).toBeVisible();
  await expectNothingPrivate(page, a);
  // Managing lists and settings needs an account.
  await page.goto("/lists");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});

test("A's privacy switch makes the profile and list answer exactly as unknown ones do", async ({ browser, page, a, b }) => {
  await page.goto("/settings");
  await page.getByLabel("Keep my library private").check();
  await page.getByRole("button", { name: "Save privacy" }).click();
  await expect.poll(() => libraryPrivate(a)).toBe(true);
  // A fresh load, so the box shows what was saved rather than what was clicked.
  await page.goto("/settings");
  await expect(page.getByLabel("Keep my library private")).toBeChecked();

  const { context, page: other } = await as(browser, b);
  const answer = async (path: string) => {
    const response = await other.goto(path);
    // The answer streams in after the shell; every answer has a heading.
    await expect(other.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    return { status: response!.status(), text: (await other.getByRole("main").innerText()).trim() };
  };
  const privateProfile = await answer(`/u/${a.username}`);
  expect(privateProfile.text).toBe(PRIVATE_OR_MISSING);
  expect(privateProfile).toEqual(await answer(`/u/user-${randomBytes(4).toString("hex")}`));
  await expectNothingPrivate(other, a);
  expect(await other.content()).not.toContain(FINISHED);

  const privateList = await answer(`/lists/${listId}`);
  expect(privateList.text).toBe(LIST_MISSING);
  expect(privateList).toEqual(await answer(`/lists/${randomUUID()}`));
  expect(privateList).toEqual(await answer("/lists/not-a-list"));
  expect(await other.content()).not.toContain(FINISHED);

  // The owner's own profile says the same while it's private: it shows what others see.
  await page.goto(`/u/${a.username}`);
  await expect(page.getByRole("main")).toHaveText(PRIVATE_OR_MISSING);

  // Public again, then a private list: gone from the profile and its URL, the library still shown.
  await page.goto("/settings");
  await page.getByLabel("Keep my library private").uncheck();
  await page.getByRole("button", { name: "Save privacy" }).click();
  await expect.poll(() => libraryPrivate(a)).toBe(false);
  await page.goto("/settings");
  await expect(page.getByLabel("Keep my library private")).not.toBeChecked();
  await page.goto("/lists");
  await page.getByRole("button", { name: `Make ${LIST} private` }).click();
  await expect(page.getByRole("button", { name: `Make ${LIST} public` })).toBeVisible();

  await other.goto(`/u/${a.username}`);
  await expect(other.getByRole("heading", { name: FINISHED, exact: true })).toBeVisible();
  await expect(other.getByRole("link", { name: LIST, exact: true })).toHaveCount(0);
  expect((await answer(`/lists/${listId}`)).text).toBe(LIST_MISSING);

  await page.getByRole("button", { name: `Make ${LIST} public` }).click();
  await expect(page.getByRole("button", { name: `Make ${LIST} private` })).toBeVisible();
  await other.goto(`/u/${a.username}`);
  await expect(other.getByRole("link", { name: LIST, exact: true })).toBeVisible();
  await context.close();
});

test("a 200-character list name is refused with a message, and long names wrap at 390 px", async ({ browser, a }) => {
  const { context, page } = await as(browser, a, 390);
  await page.goto("/lists");
  // The input has no maxlength, so the server's refusal is what's tested.
  await page.getByLabel("List name").fill("x".repeat(200));
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page).toHaveURL(/error=name/);
  await expect(page.getByText("Give the list a name of up to 80 characters.")).toBeVisible();
  const { data: refused } = await adminClient().from("lists").select("id").eq("user_id", a.userId).eq("name", "x".repeat(200));
  expect(refused).toEqual([]);

  // 80 characters with no spaces, and markup with emoji: shown as text, never sideways.
  const long = "w".repeat(80);
  for (const name of [long, "<b>Invented</b> 🎃 list"]) {
    await page.getByLabel("List name").fill(name);
    await page.getByRole("button", { name: "Create list" }).click();
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator("main b")).toHaveCount(0);
  await noSidewaysScroll(page);
  await page.getByRole("link", { name: long, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: long })).toBeVisible();
  await noSidewaysScroll(page);
  await page.goto("/library");
  await noSidewaysScroll(page);
  await page.goto(`/u/${a.username}`);
  await noSidewaysScroll(page);
  await context.close();
});

test("a list can be renamed, and deleted only with the box ticked", async ({ page }) => {
  await page.goto("/lists");
  const name = `Invented Rename Me ${suffix}`;
  await page.getByLabel("List name").fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await page.getByLabel(`Rename ${name}`).fill(`${name} renamed`);
  await page.getByRole("button", { name: `Save name of ${name}` }).click();
  const renamed = `${name} renamed`;
  await expect(page.getByRole("link", { name: renamed, exact: true })).toBeVisible();

  await page.locator("summary", { hasText: `Delete ${renamed}` }).click();
  await page.getByLabel(`Yes, delete ${renamed}`).check();
  await page.getByRole("button", { name: `Delete list ${renamed}`, exact: true }).click();
  await expect(page.getByRole("link", { name: renamed, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: LIST, exact: true })).toBeVisible();
});

test("removing an entry from a list leaves it in the library", async ({ page }) => {
  await page.goto(`/lists/${listId}`);
  await page.getByRole("button", { name: `Remove ${QUEUED} from the list` }).click();
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([FINISHED]);
  await page.goto("/library");
  await expect(libraryRow(page, QUEUED)).toBeVisible();
  await expect(libraryRow(page, QUEUED).getByText(`On ${LIST}`)).toHaveCount(0);
});

// Last: it renames A, which the tests above rely on.
test("a new username moves the profile, and an email-like one is refused", async ({ page, a }) => {
  const fresh = `invented-${suffix}`;
  await page.goto("/settings");
  await page.getByLabel("Username").fill(a.email);
  await page.getByRole("button", { name: "Save username" }).click();
  await expect(page).toHaveURL(/error=username/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(/lowercase letters, numbers or hyphens/);

  await page.getByLabel("Username").fill(fresh.toUpperCase());
  await page.getByRole("button", { name: "Save username" }).click();
  await expect(page.getByRole("banner").getByRole("link", { name: fresh })).toBeVisible();
  await page.goto(`/u/${fresh}`);
  await expect(page.getByRole("heading", { level: 1, name: fresh })).toBeVisible();
  await page.goto(`/u/${a.username}`);
  await expect(page.getByRole("main")).toHaveText(PRIVATE_OR_MISSING);
});
