import { expect, test } from "@playwright/test";
import { latestEmailTo } from "./mailpit";
import {
  codeFrom,
  newEmail,
  requestSignIn,
  signInByLink,
  signOut,
  usernameInHeader,
} from "./sign-in-helpers";

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
