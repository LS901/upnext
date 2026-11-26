import { expect, test } from "vitest";
import { seasonLabel } from "./season-label";

test("a season shows its number, episode count and year", () => {
  expect(seasonLabel({ number: 2, episodeCount: 8, airDate: "2022-09-02" })).toBe("Season 2 · 8 episodes · 2022");
  expect(seasonLabel({ number: 5, episodeCount: 1, airDate: "2030-01-01" })).toBe("Season 5 · 1 episode · 2030");
});

test("season 0 is Specials", () => {
  expect(seasonLabel({ number: 0, episodeCount: 2, airDate: "2022-12-20" })).toBe("Specials · 2 episodes · 2022");
});

test("unknown parts are left out", () => {
  expect(seasonLabel({ number: 0, episodeCount: null, airDate: null })).toBe("Specials");
  expect(seasonLabel({ number: 3, episodeCount: null, airDate: "2024-03-15" })).toBe("Season 3 · 2024");
  expect(seasonLabel({ number: 3, episodeCount: 6, airDate: "soon" })).toBe("Season 3 · 6 episodes");
});
