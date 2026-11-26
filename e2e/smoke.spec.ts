import { expect, test } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "upnext" })).toBeVisible();
});

test("credits are one click from the home page (INV-007)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Credits" }).click();
  await expect(page).toHaveURL("/credits");
  await expect(
    page.getByText("This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "IGDB.com" })).toHaveAttribute("href", "https://www.igdb.com");
});

test("serves an installable web app manifest", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();

  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "upnext", start_url: "/", display: "standalone" });

  for (const icon of manifest.icons as { src: string; sizes: string }[]) {
    const img = await request.get(icon.src);
    expect(img.ok(), `${icon.src} should load`).toBe(true);
    expect(img.headers()["content-type"]).toBe("image/png");
  }
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"])
  );
});
