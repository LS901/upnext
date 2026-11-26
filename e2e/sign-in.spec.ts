import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { latestEmailTo } from "./mailpit";

const USERNAME = /^user-[a-z0-9]{8}$/;

function newEmail(): string {
  return `newuser-${randomBytes(4).toString("hex")}@example.test`;
}

async function requestSignIn(page: Page, typed: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(typed);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  // Sending goes through Supabase Auth and the local mail catcher. On a freshly
  // started server with several workers sending at once it can take longer
  // than Playwright's 5 s default, so allow more time here.
  await expect(
    page.getByText("Check your email. Open the link, or enter the 6-digit code here.")
  ).toBeVisible({ timeout: 15_000 });
}

function linkFrom(html: string): string {
  const match = html.match(/href="([^"]*\/auth\/confirm\?[^"]*)"/);
  if (!match) throw new Error(`No sign-in link in email:\n${html}`);
  return match[1].replaceAll("&amp;", "&");
}

function codeFrom(text: string): string {
  const match = text.match(/Your code: (\d{6})/);
  if (!match) throw new Error(`No code in email:\n${text}`);
  return match[1];
}

function usernameInHeader(page: Page) {
  return page.getByRole("banner").getByText(USERNAME);
}

async function signInByLink(page: Page, typed: string, email: string) {
  await requestSignIn(page, typed);
  const { html } = await latestEmailTo(email);
  await page.goto(linkFrom(html));
  await expect(usernameInHeader(page)).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
}

test("signs in with the emailed link, then signs out", async ({ page }) => {
  const email = newEmail();
  await signInByLink(page, email, email);
  await signOut(page);
  await expect(usernameInHeader(page)).toHaveCount(0);
});

test("signs in with the emailed code", async ({ page }) => {
  const email = newEmail();
  await requestSignIn(page, email);
  const { text } = await latestEmailTo(email);

  await page.getByLabel("Code").fill(codeFrom(text));
  await page.getByRole("button", { name: "Sign in with code" }).click();

  await expect(page).toHaveURL("/");
  await expect(usernameInHeader(page)).toBeVisible();
});

test("a returning user lands on the same account, whatever the case and spacing", async ({ page }) => {
  const email = newEmail();
  await signInByLink(page, email, email);
  const username = await usernameInHeader(page).textContent();
  await signOut(page);

  await signInByLink(page, "  " + email.toUpperCase() + " ", email);
  await expect(usernameInHeader(page)).toHaveText(username!);
});

test("a wrong code shows a plain error", async ({ page }) => {
  const email = newEmail();
  await requestSignIn(page, email);
  await latestEmailTo(email);

  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Sign in with code" }).click();

  await expect(page.getByText("That code didn't work. Check it, or request a new one.")).toBeVisible();
  await expect(usernameInHeader(page)).toHaveCount(0);
});

test("a tampered link shows a plain error", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=bogus&type=email");

  await expect(page).toHaveURL("/login?error=link");
  await expect(
    page.getByText("That sign-in link has expired or was already used. Request a new one.")
  ).toBeVisible();
});
