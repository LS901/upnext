// @vitest-environment node
import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const tmdb = vi.hoisted(() => vi.fn(async () => ({ provider: "tmdb" })));
const igdb = vi.hoisted(() => vi.fn(async () => ({ provider: "igdb" })));
vi.mock("./tmdb", () => ({ getTmdbDetails: tmdb }));
vi.mock("./igdb", () => ({ getIgdbDetails: igdb }));

import { getDetails } from "./index";

test("getDetails dispatches by provider and media type", async () => {
  await getDetails("tmdb", "show", "1");
  expect(tmdb).toHaveBeenCalledWith("show", "1");
  await getDetails("igdb", "game", "2");
  expect(igdb).toHaveBeenCalledWith("2");
});

test("getDetails rejects mismatched combinations", async () => {
  await expect(getDetails("tmdb", "game", "1")).rejects.toThrow(Error);
  await expect(getDetails("igdb", "movie", "1")).rejects.toThrow(Error);
});
