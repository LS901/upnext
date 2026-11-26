// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { importItem } from "@/lib/catalogue/import";
import { ProviderError } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import { addItem, addSeasons } from "./actions";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/catalogue/import", () => ({ importItem: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const USER = { id: "user-1", username: "user-abcd1234" };
const insert = vi.fn();

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of [value].flat()) data.append(key, v);
  }
  return data;
}

const movie = (extra: Record<string, string | string[]> = {}) =>
  form({ provider: "tmdb", mediaType: "movie", providerId: "9001", q: "Kestrel", ...extra });

const pgError = (code: string) => ({ error: { code, message: `pg ${code}` } });

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(importItem).mockReset().mockResolvedValue({ itemId: "item-1", seasons: [] });
  vi.mocked(redirect).mockClear();
  insert.mockReset().mockResolvedValue({ error: null });
  vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => ({ insert })) } as never);
});

test("addItem imports, inserts a Backlog entry as the user and goes back to the search", async () => {
  await expect(addItem(movie({ exclude: ["game"] }))).rejects.toThrow(
    "redirect:/search?q=Kestrel&exclude=game&added=1",
  );
  expect(importItem).toHaveBeenCalledWith("tmdb", "movie", "9001");
  expect(insert).toHaveBeenCalledExactlyOnceWith({
    item_id: "item-1",
    item_media_type: "movie",
    user_id: USER.id,
    status: "backlog",
  });
});

test("addItem treats an existing entry (23505) as success (INV-008)", async () => {
  insert.mockResolvedValue(pgError("23505"));
  await expect(addItem(movie())).rejects.toThrow("redirect:/search?q=Kestrel&added=1");
  expect(importItem).toHaveBeenCalledTimes(1);
});

test("an item pruned between import and insert (23503) is imported again and retried once", async () => {
  vi.mocked(importItem)
    .mockResolvedValueOnce({ itemId: "pruned-item", seasons: [] })
    .mockResolvedValueOnce({ itemId: "item-2", seasons: [] });
  insert.mockResolvedValueOnce(pgError("23503")).mockResolvedValueOnce({ error: null });

  await expect(addItem(movie())).rejects.toThrow("redirect:/search?q=Kestrel&added=1");
  expect(importItem).toHaveBeenCalledTimes(2);
  expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ item_id: "item-2" }));
});

test("a second 23503 fails instead of looping", async () => {
  insert.mockResolvedValue(pgError("23503"));
  await expect(addItem(movie())).rejects.toThrow("removed while it was being added");
  expect(importItem).toHaveBeenCalledTimes(2);
  expect(redirect).not.toHaveBeenCalled();
});

test("any other insert error throws", async () => {
  insert.mockResolvedValue(pgError("42501"));
  await expect(addItem(movie())).rejects.toThrow("Couldn't add to the library: pg 42501");
  expect(redirect).not.toHaveBeenCalled();
});

test("a provider failure goes back to the search with the provider named, and logs only provider and status", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(importItem).mockRejectedValue(new ProviderError("igdb", 429));
  await expect(
    addItem(form({ provider: "igdb", mediaType: "game", providerId: "7001", q: "Clockwork" })),
  ).rejects.toThrow("redirect:/search?q=Clockwork&failed=igdb");
  expect(insert).not.toHaveBeenCalled();

  expect(log).toHaveBeenCalledOnce();
  const logged = JSON.stringify(log.mock.calls[0]);
  expect(logged).toContain("IGDB");
  expect(logged).toContain("429");
  for (const userData of ["Clockwork", "7001", USER.id, USER.username]) expect(logged).not.toContain(userData);
  log.mockRestore();
});

test("form fields that aren't text are ignored, never cast", async () => {
  const data = movie();
  data.delete("q");
  data.append("q", new Blob(["Kestrel"]), "q.txt");
  data.append("exclude", new Blob(["game"]), "exclude.txt");
  await expect(addItem(data)).rejects.toThrow("redirect:/search?added=1");

  const file = form({ provider: "tmdb", mediaType: "movie" });
  file.append("providerId", new Blob(["9001"]), "9001");
  await expect(addItem(file)).rejects.toThrow("Not a movie or game");

  const seasons = form({ tmdbId: "9101" });
  seasons.append("season", new Blob(["1"]), "1");
  await expect(addSeasons(seasons)).rejects.toThrow("redirect:/search/show/9101");
  expect(importItem).toHaveBeenCalledTimes(1); // only the first, valid add imported
});

test("addItem refuses anything but a TMDB movie or an IGDB game with a numeric id", async () => {
  for (const bad of [
    { provider: "tmdb", mediaType: "show", providerId: "9101" },
    { provider: "igdb", mediaType: "movie", providerId: "9001" },
    { provider: "tmdb", mediaType: "movie", providerId: "../9001" },
    { provider: "other", mediaType: "game", providerId: "1" },
  ]) {
    await expect(addItem(form(bad))).rejects.toThrow("Not a movie or game");
  }
  expect(importItem).not.toHaveBeenCalled();
});

test("signed-out callers are sent to sign in and nothing is imported", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(addItem(movie())).rejects.toThrow("redirect:/login");
  await expect(addSeasons(form({ tmdbId: "9101", season: "1" }))).rejects.toThrow("redirect:/login");
  expect(importItem).not.toHaveBeenCalled();
});

test("addSeasons adds the chosen seasons, skipping ones already added and unknown numbers", async () => {
  vi.mocked(importItem).mockResolvedValue({
    itemId: "show-1",
    seasons: [
      { id: "s0", number: 0 },
      { id: "s1", number: 1 },
      { id: "s2", number: 2 },
    ],
  });
  insert.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce(pgError("23505"));

  await expect(addSeasons(form({ tmdbId: "9101", season: ["0", "2", "2", "7", "x"] }))).rejects.toThrow(
    "redirect:/search/show/9101?added=1",
  );
  expect(importItem).toHaveBeenCalledWith("tmdb", "show", "9101");
  expect(insert.mock.calls.map(([row]) => row.season_id)).toEqual(["s0", "s2"]);
  expect(insert).toHaveBeenCalledWith({ season_id: "s0", user_id: USER.id, status: "backlog" });
});

test("addSeasons with nothing chosen goes back without importing", async () => {
  await expect(addSeasons(form({ tmdbId: "9101" }))).rejects.toThrow("redirect:/search/show/9101");
  expect(importItem).not.toHaveBeenCalled();
});

test("addSeasons re-imports once when the show was pruned, using the new season ids", async () => {
  vi.mocked(importItem)
    .mockResolvedValueOnce({ itemId: "old", seasons: [{ id: "old-s1", number: 1 }] })
    .mockResolvedValueOnce({ itemId: "new", seasons: [{ id: "new-s1", number: 1 }] });
  insert.mockResolvedValueOnce(pgError("23503")).mockResolvedValueOnce({ error: null });

  await expect(addSeasons(form({ tmdbId: "9101", season: "1" }))).rejects.toThrow("?added=1");
  expect(insert.mock.calls.map(([row]) => row.season_id)).toEqual(["old-s1", "new-s1"]);
});

test("addSeasons refuses a non-numeric show id", async () => {
  await expect(addSeasons(form({ tmdbId: "abc", season: "1" }))).rejects.toThrow("Not a show");
  expect(importItem).not.toHaveBeenCalled();
});
