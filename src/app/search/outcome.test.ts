import { expect, test } from "vitest";
import type { SearchResult } from "@/lib/providers/types";
import { providersToAsk, summarise } from "./outcome";

const movie: SearchResult = {
  provider: "tmdb",
  providerId: "1",
  mediaType: "movie",
  title: "Invented Film",
  year: 2020,
  imageUrl: null,
};
const show: SearchResult = { ...movie, providerId: "2", mediaType: "show", title: "Invented Show" };
const game: SearchResult = { ...movie, provider: "igdb", providerId: "3", mediaType: "game", title: "Invented Game" };

test("a failed provider never reads as Nothing found, even when the other was skipped", () => {
  // Movies and TV hidden, IGDB down.
  expect(summarise([{ provider: "tmdb", status: "skipped" }, { provider: "igdb", status: "failed" }], [])).toEqual({
    results: [],
    failed: ["igdb"],
    nothingFound: false,
    everythingHidden: false,
  });
  // Games hidden, TMDB down.
  expect(summarise([{ provider: "tmdb", status: "failed" }, { provider: "igdb", status: "skipped" }], [])).toEqual({
    results: [],
    failed: ["tmdb"],
    nothingFound: false,
    everythingHidden: false,
  });
});

test("Nothing found needs every queried provider to have answered with nothing", () => {
  const empty = { status: "answered", results: [] } as const;
  expect(summarise([{ provider: "tmdb", ...empty }, { provider: "igdb", ...empty }], []).nothingFound).toBe(true);
  expect(summarise([{ provider: "tmdb", ...empty }, { provider: "igdb", status: "skipped" }], []).nothingFound).toBe(
    true,
  );
  expect(summarise([{ provider: "tmdb", ...empty }, { provider: "igdb", status: "failed" }], []).nothingFound).toBe(
    false,
  );
});

test("nothing queried (every type hidden) is not Nothing found", () => {
  expect(
    summarise([{ provider: "tmdb", status: "skipped" }, { provider: "igdb", status: "skipped" }], []).nothingFound,
  ).toBe(false);
});

test("every type hidden asks no provider and reads as everything hidden", () => {
  const all = ["movie", "show", "game", "book"] as const;
  expect(providersToAsk(all)).toEqual([]);
  expect(summarise([{ provider: "tmdb", status: "skipped" }, { provider: "igdb", status: "skipped" }], all)).toEqual({
    results: [],
    failed: [],
    nothingFound: false,
    everythingHidden: true,
  });
});

test("a provider is asked unless every one of its types is hidden", () => {
  expect(providersToAsk([])).toEqual(["tmdb", "igdb", "hardcover"]);
  expect(providersToAsk(["movie"])).toEqual(["tmdb", "igdb", "hardcover"]);
  expect(providersToAsk(["movie", "show"])).toEqual(["igdb", "hardcover"]);
  expect(providersToAsk(["game"])).toEqual(["tmdb", "hardcover"]);
  expect(providersToAsk(["book"])).toEqual(["tmdb", "igdb"]);
  expect(providersToAsk(["movie", "show", "game"])).toEqual(["hardcover"]);
  expect(summarise([{ provider: "tmdb", status: "skipped" }, { provider: "igdb", status: "failed" }], []).everythingHidden).toBe(
    false,
  );
});

test("results of hidden types are dropped, and Nothing found turns on if none are left", () => {
  const answers = [
    { provider: "tmdb", status: "answered", results: [movie, show] },
    { provider: "igdb", status: "answered", results: [game] },
  ] as const;
  expect(summarise([...answers], [])).toEqual({
    results: [movie, show, game],
    failed: [],
    nothingFound: false,
    everythingHidden: false,
  });
  expect(summarise([...answers], ["show"]).results).toEqual([movie, game]);
  expect(summarise([answers[0], { provider: "igdb", status: "skipped" }], ["movie", "show"])).toEqual({
    results: [],
    failed: [],
    nothingFound: true,
    everythingHidden: false,
  });
});
