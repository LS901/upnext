// inLibrary and seasonsInLibrary read through the user's own client, where
// other users' public entries are readable too. They must count only the
// user's own entries.
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { inLibrary, itemKey, seasonsInLibrary } from "../../src/lib/library/in-library";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

describe("inLibrary", () => {
  let a: TestUser;
  let b: TestUser;
  // Invented ids no seed or e2e fixture uses.
  const movieId = String(randomInt(10_000_000, 99_999_999));
  const showId = String(randomInt(10_000_000, 99_999_999));
  const itemIds: string[] = [];
  const seasonIds: Record<number, string> = {};

  const movieKey = itemKey("tmdb", "movie", movieId);
  const showKey = itemKey("tmdb", "show", showId);
  // Same provider id as the movie, other provider and type: never confused with it.
  const gameKey = itemKey("igdb", "game", movieId);

  beforeAll(async () => {
    const admin = adminClient();
    const { data: items, error } = await admin
      .from("items")
      .insert([
        { provider: "tmdb", media_type: "movie", provider_id: movieId, title: "Invented Inlib Film" },
        { provider: "tmdb", media_type: "show", provider_id: showId, title: "Invented Inlib Show" },
        { provider: "igdb", media_type: "game", provider_id: movieId, title: "Invented Inlib Game" },
      ])
      .select("id, media_type");
    if (error) throw error;
    itemIds.push(...items.map((i) => i.id));
    const show = items.find((i) => i.media_type === "show")!;
    const { data: seasons, error: seasonsError } = await admin
      .from("seasons")
      .insert([0, 1, 2].map((n) => ({ show_id: show.id, season_number: n })))
      .select("id, season_number");
    if (seasonsError) throw seasonsError;
    for (const s of seasons) seasonIds[s.season_number] = s.id;

    a = await createTestUser("inlib-a");
    b = await createTestUser("inlib-b");
    // b's library is public (the default), so a can read these rows.
    const movie = items.find((i) => i.media_type === "movie")!;
    const added = await b.client.from("library_entries").insert([
      { item_id: movie.id, item_media_type: "movie" },
      { season_id: seasonIds[1] },
    ]);
    if (added.error) throw added.error;
  });

  afterAll(async () => {
    const admin = adminClient();
    if (itemIds.length) {
      await admin.from("library_entries").delete().in("season_id", Object.values(seasonIds));
      await admin.from("library_entries").delete().in("item_id", itemIds);
      await admin.from("items").delete().in("id", itemIds);
    }
    await deleteTestUsers([a, b].filter(Boolean));
  });

  test("another user's public entries don't count as in your library", async () => {
    const { data: visible } = await a.client.from("library_entries").select("id").eq("user_id", b.id);
    expect(visible?.length).toBe(2); // readable, so the filter is what keeps them out

    expect(await inLibrary(a.client, a.id, [movieKey, showKey, gameKey])).toEqual(new Set());
    expect(await seasonsInLibrary(a.client, a.id, showId)).toEqual(new Set());
  });

  test("the user's own movie and any of their seasons count, matched on provider and type", async () => {
    expect(await inLibrary(b.client, b.id, [movieKey, showKey, gameKey])).toEqual(new Set([movieKey, showKey]));
    expect(await seasonsInLibrary(b.client, b.id, showId)).toEqual(new Set([1]));

    const added = await a.client.from("library_entries").insert({ season_id: seasonIds[0] });
    expect(added.error).toBeNull();
    expect(await inLibrary(a.client, a.id, [movieKey, showKey])).toEqual(new Set([showKey]));
    expect(await seasonsInLibrary(a.client, a.id, showId)).toEqual(new Set([0]));
  });

  test("keys missing from the catalogue, or none at all, give an empty set", async () => {
    expect(await inLibrary(b.client, b.id, [])).toEqual(new Set());
    expect(await inLibrary(b.client, b.id, [itemKey("tmdb", "movie", "1")])).toEqual(new Set());
  });
});
