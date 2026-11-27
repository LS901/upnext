// Up next: one queue per media type (owner said, 2026-11-26) holding every Backlog
// entry (owner said, 2026-11-27), written through the user's own client. Only the
// user's own entries can be moved, and an entry never moves into another type's
// queue (INV-001, INV-002).
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { deleteEntry, getMyLibrary, setEntryStatus } from "../../src/lib/library/queries";
import { placeInUpNext } from "../../src/lib/library/up-next";
import { adminClient, anonClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const invented = () => String(randomInt(10_000_000, 99_999_999));

describe("Up next", () => {
  let a: TestUser;
  let b: TestUser;
  const itemIds: string[] = [];
  const item: Record<string, string> = {};
  const season: Record<number, string> = {};
  const entry: Record<string, string> = {};

  const queues = async (user: TestUser = a) => {
    const { upNext } = await getMyLibrary(user.client, user.id);
    return Object.fromEntries(Object.entries(upNext).map(([type, rows]) => [type, rows.map((r) => r.entryId)]));
  };
  const positions = async (keys: string[]) => {
    const { data, error } = await adminClient()
      .from("library_entries")
      .select("id, up_next_position")
      .in("id", keys.map((k) => entry[k]));
    if (error) throw error;
    const byId = new Map(data.map((r) => [r.id, r.up_next_position]));
    return Object.fromEntries(keys.map((k) => [k, byId.get(entry[k])]));
  };

  beforeAll(async () => {
    const admin = adminClient();
    const titles = ["Invented Queue Film One", "Invented Queue Film Two", "Invented Queue Film Three", "Invented Queue Film Four"];
    const { data: items, error } = await admin
      .from("items")
      .insert([
        ...titles.map((title) => ({ provider: "tmdb" as const, media_type: "movie" as const, provider_id: invented(), title })),
        { provider: "igdb", media_type: "game", provider_id: invented(), title: "Invented Queue Game" },
        { provider: "tmdb", media_type: "show", provider_id: invented(), title: "Invented Queue Show" },
      ])
      .select("id, title");
    if (error) throw error;
    for (const i of items) itemIds.push(i.id);
    const byTitle = new Map(items.map((i) => [i.title, i.id]));
    titles.forEach((t, n) => (item[`m${n + 1}`] = byTitle.get(t)!));
    item.game = byTitle.get("Invented Queue Game")!;
    item.show = byTitle.get("Invented Queue Show")!;

    const { data: seasons, error: seasonsError } = await admin
      .from("seasons")
      .insert([1, 2].map((n) => ({ show_id: item.show, season_number: n })))
      .select("id, season_number");
    if (seasonsError) throw seasonsError;
    for (const s of seasons) season[s.season_number] = s.id;

    a = await createTestUser("upnext-a");
    b = await createTestUser("upnext-b");

    const add = async (user: TestUser, key: string, row: object) => {
      const { data, error } = await user.client.from("library_entries").insert(row).select("id").single();
      if (error) throw error;
      entry[key] = data.id;
    };
    for (const m of ["m1", "m2", "m3"]) await add(a, m, { item_id: item[m], item_media_type: "movie" });
    await add(a, "m4", { item_id: item.m4, item_media_type: "movie", status: "paused" });
    await add(a, "game", { item_id: item.game, item_media_type: "game" });
    await add(a, "s1", { season_id: season[1] });
    await add(a, "s2", { season_id: season[2] });
    // b's library is public (the default), so a's client can read this entry.
    await add(b, "bMovie", { item_id: item.m1, item_media_type: "movie", up_next_position: 1 });
    await add(b, "bMovie2", { item_id: item.m2, item_media_type: "movie", up_next_position: 2 });
    await add(b, "bGame", { item_id: item.game, item_media_type: "game" });
  });

  afterAll(async () => {
    await deleteTestUsers([a, b].filter(Boolean));
    if (itemIds.length) await adminClient().from("items").delete().in("id", itemIds);
  });

  test("each type has its own queue, and adding goes to the bottom of that type's queue", async () => {
    // Added in beforeAll: m1, m2, m3 (m4 Paused), the game, then seasons 1 and 2.
    expect(await queues()).toEqual({
      movie: [entry.m1, entry.m2, entry.m3],
      show: [entry.s1, entry.s2],
      game: [entry.game],
    });
    // The game and the seasons start their own queues rather than joining the movies'.
    expect(await positions(["m1", "m2", "m3", "game", "s1", "s2"])).toEqual({ m1: 1, m2: 2, m3: 3, game: 1, s1: 1, s2: 2 });

    // Every Backlog entry is in its queue, so there's no Backlog group.
    const { groups } = await getMyLibrary(a.client, a.id);
    expect(groups.map((g) => g.status)).toEqual(["paused"]);
  });

  test("adding twice keeps one place, and only Backlog entries are queued", async () => {
    const again = await a.client.from("library_entries").insert({ item_id: item.m1, item_media_type: "movie" });
    expect(again.error?.code).toBe("23505");
    expect((await queues()).movie).toEqual([entry.m1, entry.m2, entry.m3]);
    expect(await positions(["m4"])).toEqual({ m4: null });
  });

  test("a move sends an exact target, so repeating it (a double-click, a stale page) changes nothing", async () => {
    await placeInUpNext(a.client, a.id, entry.m3, entry.m1); // Move to top
    await placeInUpNext(a.client, a.id, entry.m3, entry.m1);
    expect((await queues()).movie).toEqual([entry.m3, entry.m1, entry.m2]);
    await placeInUpNext(a.client, a.id, entry.m3, entry.m2); // Move down
    await placeInUpNext(a.client, a.id, entry.m3, entry.m2);
    expect((await queues()).movie).toEqual([entry.m1, entry.m3, entry.m2]);
    await placeInUpNext(a.client, a.id, entry.m2, entry.m3); // Move up
    await placeInUpNext(a.client, a.id, entry.m2, entry.m3);
    expect((await queues()).movie).toEqual([entry.m1, entry.m2, entry.m3]);
    expect(await positions(["game", "s1"])).toEqual({ game: 1, s1: 1 });
  });

  test("when positions are tied (two adds at once), a move renumbers the queue 1..n in one go", async () => {
    const tie = await adminClient()
      .from("library_entries")
      .update({ up_next_position: 7 })
      .in("id", [entry.m1, entry.m2, entry.m3]);
    if (tie.error) throw tie.error;
    const [first, second, third] = (await queues()).movie; // ties settle by entry id

    await placeInUpNext(a.client, a.id, third, second);
    expect((await queues()).movie).toEqual([first, third, second]);
    const { data } = await adminClient()
      .from("library_entries")
      .select("id, up_next_position")
      .in("id", [first, second, third]);
    expect(Object.fromEntries(data!.map((r) => [r.id, r.up_next_position]))).toEqual({ [first]: 1, [third]: 2, [second]: 3 });

    // Put them back as the later tests expect: m1, m2, m3.
    await placeInUpNext(a.client, a.id, entry.m1, (await queues()).movie[0]);
    await placeInUpNext(a.client, a.id, entry.m3, null);
    await placeInUpNext(a.client, a.id, entry.m2, entry.m3);
    expect((await queues()).movie).toEqual([entry.m1, entry.m2, entry.m3]);
  });

  test("a queued season leaves its show's Backlog row; progress still counts every season", async () => {
    await setEntryStatus(a.client, a.id, entry.s2, "finished");
    const { groups } = await getMyLibrary(a.client, a.id);
    expect(groups.find((g) => g.status === "backlog")).toBeUndefined();
    const finished = groups.find((g) => g.status === "finished")!;
    expect(finished.rows).toEqual([
      expect.objectContaining({
        title: "Invented Queue Show",
        progress: { finished: 1, total: 2 },
        seasons: [expect.objectContaining({ entryId: entry.s2 })],
      }),
    ]);
    await setEntryStatus(a.client, a.id, entry.s2, "backlog");
  });

  test("a drag places an entry before another in the same queue, never into another type's", async () => {
    await placeInUpNext(a.client, a.id, entry.m3, entry.m1);
    expect((await queues()).movie).toEqual([entry.m3, entry.m1, entry.m2]);
    await placeInUpNext(a.client, a.id, entry.m3, null);
    expect((await queues()).movie).toEqual([entry.m1, entry.m2, entry.m3]);

    // Before the game, or before b's entry: neither is in a's movie queue, so nothing moves.
    await placeInUpNext(a.client, a.id, entry.m1, entry.game);
    await placeInUpNext(a.client, a.id, entry.m1, entry.bMovie);
    expect(await queues()).toEqual({
      movie: [entry.m1, entry.m2, entry.m3],
      show: [entry.s1, entry.s2],
      game: [entry.game],
    });
  });

  test("remove and start take an entry off its queue; a second remove does nothing", async () => {
    // Remove deletes the entry from the library; a double-click is quiet.
    await deleteEntry(a.client, a.id, entry.m2);
    await deleteEntry(a.client, a.id, entry.m2);
    expect((await queues()).movie).toEqual([entry.m1, entry.m3]);
    const { data: removed } = await adminClient().from("library_entries").select("status").eq("id", entry.m2);
    expect(removed).toEqual([]);

    await setEntryStatus(a.client, a.id, entry.m1, "in_progress");
    expect((await queues()).movie).toEqual([entry.m3]);
  });

  test("another user's queue never shows in yours, and their entries can't be moved", async () => {
    expect(await queues(b)).toEqual({ movie: [entry.bMovie, entry.bMovie2], show: [], game: [entry.bGame] });
    expect((await queues()).movie).not.toContain(entry.bMovie);

    const refused = "That entry isn't in your library.";
    await expect(placeInUpNext(a.client, a.id, entry.bMovie, null)).rejects.toThrow(refused);
    // Even passing b's own id, where the move would really change something,
    // RLS lets a's client change nothing.
    await expect(placeInUpNext(a.client, b.id, entry.bMovie2, entry.bMovie)).rejects.toThrow(refused);

    expect(await positions(["bMovie", "bMovie2", "bGame"])).toEqual({ bMovie: 1, bMovie2: 2, bGame: 1 });
  });

  test("the renumber function only touches the caller's own queued Backlog entries, and only signed in", async () => {
    // Another user's queued entry.
    const { data: theirs, error } = await a.client.rpc("set_up_next_order", { entry_ids: [entry.bMovie2, entry.bMovie] });
    if (error) throw error;
    expect(theirs).toBe(0);
    // The caller's own, but not queued: m2 was removed, m4 is Paused.
    const { data: unqueued, error: ownError } = await a.client.rpc("set_up_next_order", { entry_ids: [entry.m2, entry.m4] });
    if (ownError) throw ownError;
    expect(unqueued).toBe(0);
    // Signed out, it can't be called at all.
    const { error: anonError } = await anonClient().rpc("set_up_next_order", { entry_ids: [entry.m3] });
    expect(anonError).not.toBeNull();

    expect(await positions(["bMovie", "bMovie2", "m4"])).toEqual({ bMovie: 1, bMovie2: 2, m4: null });
  });
});
