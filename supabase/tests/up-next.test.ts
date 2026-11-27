// Up next: one queue per media type (owner said, 2026-11-26), written through the
// user's own client. Only the user's own Backlog entries can be queued or moved,
// and an entry never moves into another type's queue (INV-001, INV-002).
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { getMyLibrary, setEntryStatus } from "../../src/lib/library/queries";
import { addToUpNext, placeInUpNext, removeFromUpNext } from "../../src/lib/library/up-next";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

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
  });

  afterAll(async () => {
    await deleteTestUsers([a, b].filter(Boolean));
    if (itemIds.length) await adminClient().from("items").delete().in("id", itemIds);
  });

  test("each type has its own queue, and adding goes to the bottom of that type's queue", async () => {
    for (const key of ["m1", "m2", "game", "s1", "m3"]) await addToUpNext(a.client, a.id, entry[key]);

    expect(await queues()).toEqual({
      movie: [entry.m1, entry.m2, entry.m3],
      show: [entry.s1],
      game: [entry.game],
    });
    // The game and the season start their own queues rather than joining the movies'.
    expect(await positions(["m1", "m2", "m3", "game", "s1"])).toEqual({ m1: 1, m2: 2, m3: 3, game: 1, s1: 1 });

    // Queued entries show in their queue, not again under Backlog.
    const { groups } = await getMyLibrary(a.client, a.id);
    const backlog = groups.find((g) => g.status === "backlog")!;
    expect(backlog.rows.map((r) => r.title)).toEqual(["Invented Queue Show"]);
    expect(backlog.rows[0]).toMatchObject({ seasons: [expect.objectContaining({ entryId: entry.s2 })] });
  });

  test("adding twice keeps one place, and only Backlog entries can be queued", async () => {
    await addToUpNext(a.client, a.id, entry.m1);
    expect((await queues()).movie).toEqual([entry.m1, entry.m2, entry.m3]);
    await expect(addToUpNext(a.client, a.id, entry.m4)).rejects.toThrow("Only Backlog entries can go in Up next.");
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
    expect(await queues()).toEqual({ movie: [entry.m1, entry.m2, entry.m3], show: [entry.s1], game: [entry.game] });
  });

  test("remove and start take an entry off its queue; a second remove does nothing", async () => {
    await removeFromUpNext(a.client, a.id, entry.m2);
    await removeFromUpNext(a.client, a.id, entry.m2);
    expect((await queues()).movie).toEqual([entry.m1, entry.m3]);
    const { data: removed } = await adminClient().from("library_entries").select("status").eq("id", entry.m2).single();
    expect(removed).toEqual({ status: "backlog" });

    await setEntryStatus(a.client, a.id, entry.m1, "in_progress");
    expect((await queues()).movie).toEqual([entry.m3]);
  });

  test("another user's queue never shows in yours, and their entries can't be queued, moved or removed", async () => {
    expect(await queues(b)).toEqual({ movie: [entry.bMovie], show: [], game: [] });
    expect((await queues()).movie).not.toContain(entry.bMovie);

    const refused = "That entry isn't in your library.";
    await expect(addToUpNext(a.client, a.id, entry.bMovie)).rejects.toThrow(refused);
    await expect(placeInUpNext(a.client, a.id, entry.bMovie, null)).rejects.toThrow(refused);
    await expect(removeFromUpNext(a.client, a.id, entry.bMovie)).rejects.toThrow(refused);
    // Even passing b's own id, RLS lets a's client change nothing.
    await expect(removeFromUpNext(a.client, b.id, entry.bMovie)).rejects.toThrow(refused);
    await addToUpNext(a.client, b.id, entry.bMovie).catch(() => {});
    await placeInUpNext(a.client, b.id, entry.bMovie, null).catch(() => {});
    // Nor through the renumber function: it only ever touches the caller's rows.
    const { data: touched } = await a.client.rpc("set_up_next_order", { entry_ids: [entry.bMovie] });
    expect(touched).toBe(0);

    expect(await positions(["bMovie"])).toEqual({ bMovie: 1 });
  });
});
