import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { latestEmailTo } from "./mailpit";

export const USERNAME = /^user-[a-z0-9]{8}$/;

export function newEmail(): string {
  return `newuser-${randomBytes(4).toString("hex")}@example.test`;
}

export async function requestSignIn(page: Page, typed: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(typed);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByText("Check your email. Open the link, or enter the 6-digit code here.")
  ).toBeVisible();
}

export function linkFrom(html: string): string {
  const match = html.match(/href="([^"]*\/auth\/confirm\?[^"]*)"/);
  if (!match) throw new Error(`No sign-in link in email:\n${html}`);
  return match[1].replaceAll("&amp;", "&");
}

export function codeFrom(text: string): string {
  const match = text.match(/Your code: (\d{6})/);
  if (!match) throw new Error(`No code in email:\n${text}`);
  return match[1];
}

export function usernameInHeader(page: Page) {
  return page.getByRole("banner").getByText(USERNAME);
}

export async function signInByLink(page: Page, typed: string, email: string) {
  await requestSignIn(page, typed);
  const { html } = await latestEmailTo(email);
  await page.goto(linkFrom(html));
  await expect(usernameInHeader(page)).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
}
