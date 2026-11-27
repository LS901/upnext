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
])("on %s, %s is the current page and the others aren't", (path, current) => {
  pathname = path;
  render(<NavLinks />);
  for (const name of ["Home", "Search", "My library"]) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("aria-current")).toBe(name === current ? "page" : null);
  }
  expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
  expect(screen.getByRole("link", { name: "Search" }).getAttribute("href")).toBe("/search");
  expect(screen.getByRole("link", { name: "My library" }).getAttribute("href")).toBe("/library");
});
