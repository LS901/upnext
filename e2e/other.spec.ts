import { randomBytes } from "node:crypto";
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "./local-supabase";
import { newEmail, signInByLink, usernameInHeader } from "./sign-in-helpers";

const APP = "http://localhost:3100";

type Account = { state: Awaited<ReturnType<BrowserContext["storageState"]>> };

// One fresh user, signed in once per worker (local Auth rate-limits sign-in emails).
const test = base.extend<object, { account: Account }>({
  account: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({ baseURL: APP });
      const page = await context.newPage();
      const email = newEmail();
      await signInByLink(page, email, email);
      await usernameInHeader(page).textContent();
      const state = await context.storageState();
      await context.close();
      await provide({ state });
    },
    { scope: "worker" },
  ],
  storageState: async ({ account }, provide) => provide(account.state),
});
test.describe.configure({ mode: "default" });

async function addOwn(page: Page, title: string, length?: string) {
  await page.goto("/search");
  await page.locator("summary", { hasText: "Add your own" }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  if (length !== undefined) await page.getByLabel("Length (optional)").fill(length);
  await page.getByRole("button", { name: "Add your own" }).click();
  await expect(page).toHaveURL(/added=1/);
}

function queue(page: Page) {
  return page.getByRole("list", { name: "Other up next", exact: true });
}

function queued(page: Page, title: string) {
  return queue(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 4, name: title, exact: true }) });
}

async function itemsTitled(title: string) {
  const { data, error } = await adminClient().from("items").select("id").eq("title", title);
  if (error) throw error;
  return data;
}

test("add your own from search: it queues in Other with its length", async ({ page }) => {
  await addOwn(page, "Invented Channel Let's Play", "24 episodes");

  await page.goto("/library");
  const row = queued(page, "Invented Channel Let's Play");
  await expect(row).toBeVisible();
  await expect(row.getByText("Other · 24 episodes", { exact: true })).toBeVisible();
});

test("a title with markup renders as text, and no length reads just Other", async ({ page }) => {
  await addOwn(page, "<b>x</b>");
  await page.goto("/library");
  const row = queued(page, "<b>x</b>");
  await expect(row).toBeVisible();
  await expect(row.getByText("Other", { exact: true })).toBeVisible();
  await expect(page.locator("main b")).toHaveCount(0);
});

test("a 201-character title shows the message and keeps the search", async ({ page }) => {
  const long = "a".repeat(201);
  await page.goto("/search?q=anything&exclude=game");
  await page.locator("summary", { hasText: "Add your own" }).click();
  // The input has no maxlength, so the server's refusal is what's tested.
  await page.getByLabel("Title", { exact: true }).fill(long);
  await page.getByRole("button", { name: "Add your own" }).click();
  await expect(page).toHaveURL(/error=own-entry/);
  await expect(page).toHaveURL(/q=anything/);
  await expect(page).toHaveURL(/exclude=game/);
  await expect(page.getByText("Give it a title of up to 200 characters.")).toBeVisible();
  expect(await itemsTitled(long)).toEqual([]);
});

test("Remove deletes an Other entry and its item", async ({ page }) => {
  // Unique, because the database keeps the rows of earlier runs.
  const title = `Invented Removable Thing ${randomBytes(4).toString("hex")}`;
  await addOwn(page, title, "3 hours");
  expect(await itemsTitled(title)).toHaveLength(1);
  await page.goto("/library");
  const row = queued(page, title);
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);
  expect(await itemsTitled(title)).toEqual([]);
});

test("a finished Other entry offers Done again", async ({ page }) => {
  await addOwn(page, "Invented Finished Thing");
  await page.goto("/library");
  const row = queued(page, "Invented Finished Thing");
  await row.getByLabel("Status").selectOption("finished");
  await expect(row).toHaveCount(0);
  const done = page.getByRole("region", { name: "Finished", exact: true });
  const finished = done.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Invented Finished Thing", exact: true }) });
  await finished.getByRole("button", { name: "Done again" }).click();
  await expect(finished.getByText("Done 2 times")).toBeVisible();
});
