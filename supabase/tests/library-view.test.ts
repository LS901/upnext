// My library reads and writes through the user's own client, which can read
// other users' public entries and exclusions too. Only the user's own rows may
// show, count towards progress, or change (INV-001, INV-002).
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { deleteEntry, getMyLibrary, setEntryStatus, type ShowRow } from "../../src/lib/library/queries";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const invented = () => String(randomInt(10_000_000, 99_999_999));

describe("My library", () => {
  let a: TestUser;
  let b: TestUser;
  const itemIds: string[] = [];
  const ids = { movie: "", game: "", show: "", book: "" };
  const season: Record<number, string> = {};
  const entry: Record<string, string> = {};

  beforeAll(async () => {
    const admin = adminClient();
    const { data: items, error } = await admin
      .from("items")
      .insert([
        {
          provider: "tmdb",
          media_type: "movie",
          provider_id: invented(),
          title: "Invented Libview Film",
          runtime_minutes: 125,
          score: 71,
          score_count: 321,
        },
        {
          provider: "igdb",
          media_type: "game",
          provider_id: invented(),
          title: "Invented Libview Game",
          image_ref: "invented-cover",
          ttb_normally_s: 43_200,
        },
        { provider: "tmdb", media_type: "show", provider_id: invented(), title: "Invented Libview Show" },
      ])
      .select("id, media_type");
    if (error) throw error;
    for (const i of items) {
      itemIds.push(i.id);
      ids[i.media_type] = i.id;
    }
    const { data: seasons, error: seasonsError } = await admin
      .from("seasons")
      .insert([0, 1, 2, 3].map((n) => ({ show_id: ids.show, season_number: n, runtime_minutes: n === 1 ? 98 : null })))
      .select("id, season_number");
    if (seasonsError) throw seasonsError;
    for (const s of seasons) season[s.season_number] = s.id;

    a = await createTestUser("libview-a");
    b = await createTestUser("libview-b");

    const add = async (user: TestUser, key: string, row: object) => {
      const { data, error } = await user.client.from("library_entries").insert(row).select("id").single();
      if (error) throw error;
      entry[key] = data.id;
    };
    await add(a, "aGame", { item_id: ids.game, item_media_type: "game", status: "in_progress" });
    await add(a, "aS1", { season_id: season[1] });
    await add(a, "aS2", { season_id: season[2], status: "finished" });
    await add(a, "aMovie", { item_id: ids.movie, item_media_type: "movie", up_next_position: 1 });
    // b's library is public (the default), so a's client can read all of these.
    await add(b, "bMovie", { item_id: ids.movie, item_media_type: "movie", status: "dropped" });
    await add(b, "bS1", { season_id: season[1], status: "finished" });
    await add(b, "bS3", { season_id: season[3], status: "paused" });

    const excluded = await Promise.all([
      a.client.from("progress_exclusions").insert({ season_id: season[3] }),
      b.client.from("progress_exclusions").insert({ season_id: season[2] }),
    ]);
    for (const { error } of excluded) if (error) throw error;
  });

  afterAll(async () => {
    // Entries and exclusions go with their users; then the catalogue rows can.
    await deleteTestUsers([a, b].filter(Boolean));
    if (itemIds.length) await adminClient().from("items").delete().in("id", itemIds);
  });

  test("shows only the user's own entries, grouped by status, seasons under their show", async () => {
    const { data: visible } = await a.client.from("library_entries").select("id").eq("user_id", b.id);
    expect(visible?.length).toBe(3); // readable, so the filter is what keeps them out

    const { groups } = await getMyLibrary(a.client, a.id);
    // Backlog entries are all in Up next, so there's no Backlog group.
    expect(groups.map((g) => g.label)).toEqual(["In progress", "Finished"]);
    const [playing, finished] = groups;

    expect(playing.rows).toEqual([
      expect.objectContaining({
        kind: "item",
        entryId: entry.aGame,
        mediaType: "game",
        imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/invented-cover.jpg",
        minutes: 720,
        score: null,
        scoreCount: null,
      }),
    ]);
    // The film and season 1 are in Up next, so they show in their queues.
    const { upNext } = await getMyLibrary(a.client, a.id);
    expect(upNext.movie).toEqual([
      expect.objectContaining({ entryId: entry.aMovie, minutes: 125, score: 71, scoreCount: 321, imageUrl: null }),
    ]);
    expect(upNext.show).toEqual([
      expect.objectContaining({
        kind: "season",
        showTitle: "Invented Libview Show",
        entryId: entry.aS1,
        status: "backlog",
        number: 1,
        episodeCount: null,
        airDate: null,
        runtimeMinutes: 98,
      }),
    ]);
    expect(upNext.game).toEqual([]);
    expect((finished.rows[0] as ShowRow).seasons.map((s) => s.entryId)).toEqual([entry.aS2]);
  });

  test("progress counts every season 1 and up, minus only the user's own exclusions", async () => {
    // a: seasons 1-3 minus a's exclusion of 3 = 2; a finished season 2. b's
    // exclusion of season 2 and b's finished season 1 must not count.
    const { groups } = await getMyLibrary(a.client, a.id);
    const shows = groups.flatMap((g) => g.rows).filter((r): r is ShowRow => r.kind === "show");
    // One show row: season 1 is in Up next, season 2 under Finished.
    expect(shows.map((s) => s.progress)).toEqual([{ finished: 1, total: 2 }]);

    // b: seasons 1-3 minus b's exclusion of 2 = 2; b finished season 1.
    const other = await getMyLibrary(b.client, b.id);
    expect(other.groups.map((g) => g.label)).toEqual(["Paused", "Finished", "Dropped"]);
    expect(other.groups.flatMap((g) => g.rows).map((r) => (r.kind === "show" ? r.progress : r.kind === "item" ? r.entryId : r.seriesId))).toEqual([
      { finished: 1, total: 2 },
      { finished: 1, total: 2 },
      entry.bMovie,
    ]);
  });

  test("another user's entries can't be changed or removed", async () => {
    await expect(setEntryStatus(a.client, a.id, entry.bMovie, "finished")).rejects.toThrow(
      "That entry isn't in your library.",
    );
    // Even when the caller passes the owner's id, RLS changes nothing.
    await expect(setEntryStatus(a.client, b.id, entry.bMovie, "finished")).rejects.toThrow(
      "That entry isn't in your library.",
    );
    // A delete reads "already gone" either way, so it tells the caller
    // nothing about another user's entry, and removes nothing.
    await expect(deleteEntry(a.client, a.id, entry.bS1)).resolves.toBeUndefined();
    await expect(deleteEntry(a.client, b.id, entry.bS1)).resolves.toBeUndefined();

    const { data } = await adminClient().from("library_entries").select("id, status").in("id", [entry.bMovie, entry.bS1]);
    expect(data).toEqual(
      expect.arrayContaining([
        { id: entry.bMovie, status: "dropped" },
        { id: entry.bS1, status: "finished" },
      ]),
    );
    expect(data).toHaveLength(2);
  });

  test("the user changes and removes their own entries", async () => {
    // Leaving Backlog takes the entry off up next (the schema allows a position only in Backlog).
    await setEntryStatus(a.client, a.id, entry.aMovie, "paused");
    const { data: moved } = await adminClient()
      .from("library_entries")
      .select("status, up_next_position")
      .eq("id", entry.aMovie)
      .single();
    expect(moved).toEqual({ status: "paused", up_next_position: null });

    await deleteEntry(a.client, a.id, entry.aMovie);
    const { count } = await adminClient()
      .from("library_entries")
      .select("id", { count: "exact", head: true })
      .eq("id", entry.aMovie);
    expect(count).toBe(0);
    // A second Remove (a double-click) finds it already gone: that's success.
    await expect(deleteEntry(a.client, a.id, entry.aMovie)).resolves.toBeUndefined();
  });
});
