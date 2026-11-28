import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { TypeTabs } from "./type-tabs";

const counts = { all: 20, movie: 12, show: 3, game: 4, book: 0, other: 1 };
const hrefFor = (t: string) => (t === "all" ? "/library" : `/library?type=${t}`);

test("renders a link per tab with its count, and marks the current one", () => {
  render(<TypeTabs current="game" counts={counts} hrefFor={hrefFor} />);
  const links = screen.getAllByRole("link");
  expect(links.map((l) => l.textContent)).toEqual([
    "All (20)",
    "Movies (12)",
    "TV (3)",
    "Games (4)",
    "Books (0)",
    "Other (1)",
  ]);
  expect(links.map((l) => l.getAttribute("href"))).toEqual([
    "/library",
    "/library?type=movie",
    "/library?type=show",
    "/library?type=game",
    "/library?type=book",
    "/library?type=other",
  ]);
  expect(screen.getByRole("link", { name: "Games (4)" }).getAttribute("aria-current")).toBe("page");
  expect(links.filter((l) => l.getAttribute("aria-current")).length).toBe(1);
});

test("All is current on All", () => {
  render(<TypeTabs current="all" counts={counts} hrefFor={hrefFor} />);
  expect(screen.getByRole("link", { name: "All (20)" }).getAttribute("aria-current")).toBe("page");
});
