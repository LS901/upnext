import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavLinks } from "./nav-links";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

test.each([
  ["/", "Home"],
  ["/search", "Search"],
  ["/search/show/9101", "Search"],
  ["/library", "My library"],
  ["/lists", "Lists"],
  ["/lists/0b5d6c1e-3f7a-4d2b-9c8e-1a2b3c4d5e6f", "Lists"],
])("on %s, %s is the current page and the others aren't", (path, current) => {
  pathname = path;
  render(<NavLinks />);
  for (const name of ["Home", "Search", "My library", "Lists"]) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("aria-current")).toBe(name === current ? "page" : null);
  }
  expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
  expect(screen.getByRole("link", { name: "Search" }).getAttribute("href")).toBe("/search");
  expect(screen.getByRole("link", { name: "My library" }).getAttribute("href")).toBe("/library");
  expect(screen.getByRole("link", { name: "Lists" }).getAttribute("href")).toBe("/lists");
});
