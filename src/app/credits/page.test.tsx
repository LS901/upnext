import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import CreditsPage from "./page";

// INV-007: provider data is never shown without its required attribution.
// The TMDB wording is fixed by its API terms (domain/reference/metadata.md).
const TMDB_NOTICE = "This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

test("shows the exact TMDB notice", () => {
  render(<CreditsPage />);
  expect(screen.getByText(TMDB_NOTICE)).toBeDefined();
});

test("credits IGDB with a link to IGDB.com", () => {
  render(<CreditsPage />);
  const link = screen.getByRole("link", { name: /IGDB/ });
  expect(link.getAttribute("href")).toBe("https://www.igdb.com");
});

test("shows the TMDB logo linking to themoviedb.org", () => {
  render(<CreditsPage />);
  const logo = screen.getByRole("img", { name: "TMDB" });
  expect(logo.closest("a")?.getAttribute("href")).toBe("https://www.themoviedb.org");
});

test("credits Hardcover with a link to hardcover.app", () => {
  render(<CreditsPage />);
  const link = screen.getByRole("link", { name: "Book data from Hardcover" });
  expect(link.getAttribute("href")).toBe("https://hardcover.app");
});
