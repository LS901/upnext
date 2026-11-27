// The dashboard reads only the caller's rows (INV-001): the release radar holds the
// caller's future Backlog entries, and Recently finished follows finished_at.
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { getDashboard } from "../../src/lib/library/dashboard";
import { summarise } from "../../src/lib/library/dashboard-summary";
import { getMyLibrary } from "../../src/lib/library/queries";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const invented = () => String(randomInt(10_000_000, 99_999_999));
const TODAY = "2026-11-27";
const day = (offset: number) => new Date(Date.parse(TODAY) + offset * 86_400_000).toISOString().slice(0, 10);

describe("Dashboard data", () => {
  let a: TestUser;
  let b: TestUser;
  const itemIds: string[] = [];
  const entry: Record<string, string> = {};

  beforeAll(async () => {
    const admin = adminClient();
    const movie = (title: string, release_date: string | null) => ({
      provider: "tmdb" as const,
      media_type: "movie" as const,
      provider_id: invented(),
      title,
      release_date,
    });
    const { data: items, error } = await admin
      .from("items")
      .insert([
        movie("Dash Future Film", day(20)),
        movie("Dash Past Film", day(-10)),
        movie("Dash Busy Film", day(3)),
        movie("Dash Other Film", day(4)),
        movie("Dash Finished One", day(-300)),
        movie("Dash Finished Two", day(-200)),
        movie("Dash Other Finished", day(-100)),
        { provider: "igdb", media_type: "game", provider_id: invented(), title: "Dash Undated Game", release_date: null },
        { provider: "tmdb", media_type: "show", provider_id: invented(), title: "Dash Future Show", release_date: day(-50) },
      ])
      .select("id, title");
    if (error) throw error;
    for (const i of items) itemIds.push(i.id);
    const id = Object.fromEntries(items.map((i) => [i.title, i.id]));

    const { data: seasons, error: seasonError } = await admin
      .from("seasons")
      .insert([{ show_id: id["Dash Future Show"], season_number: 2, air_date: day(5) }])
      .select("id");
    if (seasonError) throw seasonError;

    a = await createTestUser("dash-a");
    b = await createTestUser("dash-b");
    const add = async (user: TestUser, key: string, row: object) => {
      const { data, error } = await user.client.from("library_entries").insert(row).select("id").single();
      if (error) throw error;
      entry[key] = data.id;
    };
    const movieEntry = (title: string, extra: object = {}) => ({ item_id: id[title], item_media_type: "movie", ...extra });
    await add(a, "future", movieEntry("Dash Future Film"));
    await add(a, "season", { season_id: seasons[0].id });
    await add(a, "past", movieEntry("Dash Past Film"));
    await add(a, "game", { item_id: id["Dash Undated Game"], item_media_type: "game" });
    await add(a, "busy", movieEntry("Dash Busy Film", { status: "in_progress" }));
    await add(a, "finA", movieEntry("Dash Finished One"));
    await add(a, "finB", movieEntry("Dash Finished Two"));
    // b's library is public by default, so a's client can read this entry.
    await add(b, "bFuture", movieEntry("Dash Other Film"));
    // b's Finished entry is stamped newer than everything (other tests leave public Finished rows behind), so it would head a's list if it leaked.
    await add(b, "bFinished", movieEntry("Dash Other Finished", { status: "finished" }));
    const { error: stampError } = await admin
      .from("library_entries")
      .update({ finished_at: "2099-01-01T00:00:00Z" })
      .eq("id", entry.bFinished);
    if (stampError) throw stampError;
  });

  afterAll(async () => {
    await deleteTestUsers([a, b].filter(Boolean));
    if (itemIds.length) await adminClient().from("items").delete().in("id", itemIds);
  });

  test("the radar holds only the caller's future Backlog entries, soonest first", async () => {
    const { radar } = await getDashboard(a.client, a.id, TODAY);
    expect(radar).toEqual([
      expect.objectContaining({ entryId: entry.season, title: "Dash Future Show", mediaType: "show", seasonNumber: 2, releaseDate: day(5) }),
      expect.objectContaining({ entryId: entry.future, title: "Dash Future Film", mediaType: "movie", seasonNumber: null, releaseDate: day(20) }),
    ]);
  });

  test("recently finished orders by finished_at, not by later edits", async () => {
    const admin = adminClient();
    for (const k of ["finA", "finB"]) {
      const { error } = await a.client.from("library_entries").update({ status: "finished" }).eq("id", entry[k]);
      if (error) throw error;
    }
    for (const [k, at] of [
      ["finA", "2026-11-01T12:00:00Z"],
      ["finB", "2026-11-20T12:00:00Z"],
    ] as const) {
      const { error } = await admin.from("library_entries").update({ finished_at: at }).eq("id", entry[k]);
      if (error) throw error;
    }
    const { error } = await a.client.from("library_entries").update({ play_count: 3 }).eq("id", entry.finA);
    if (error) throw error;

    const { recentlyFinished } = await getDashboard(a.client, a.id, TODAY);
    expect(recentlyFinished.map((e) => e.entryId)).toEqual([entry.finB, entry.finA]);
    expect(recentlyFinished[0]).toMatchObject({ title: "Dash Finished Two", mediaType: "movie", seasonNumber: null });
    expect(new Date(recentlyFinished[0].finishedAt).toISOString()).toBe("2026-11-20T12:00:00.000Z");
  });

  test("recently finished holds only the caller's entries (INV-001)", async () => {
    // Control: b's library is public, so a's client can read b's Finished row. Only the user_id filter keeps it out.
    const { data: visible, error } = await a.client.from("library_entries").select("id").eq("id", entry.bFinished);
    if (error) throw error;
    expect(visible).toHaveLength(1);

    const { recentlyFinished } = await getDashboard(a.client, a.id, TODAY);
    expect(recentlyFinished.map((e) => e.entryId)).not.toContain(entry.bFinished);
    expect(recentlyFinished.map((e) => e.title)).not.toContain("Dash Other Finished");
  });

  test("stats match summarise of the same library", async () => {
    const dash = await getDashboard(a.client, a.id, TODAY);
    expect(dash.stats).toEqual(summarise(await getMyLibrary(a.client, a.id)));
    expect(dash.stats).toMatchObject({ backlog: 4, inProgress: 1, finished: 2 });
  });
});
