import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from "./helpers";

describe("library entries", () => {
  let a: TestUser;
  let b: TestUser;
  let movieId: string;
  let showId: string;
  const seasonIds: Record<number, string> = {};

  beforeAll(async () => {
    const admin = adminClient();
    const { data: items, error } = await admin
      .from("items")
      .select("id, title")
      .in("title", ["Lanterns Over Kesh", "Harbour Lights"]);
    expect(error).toBeNull();
    movieId = items!.find((i) => i.title === "Lanterns Over Kesh")!.id;
    showId = items!.find((i) => i.title === "Harbour Lights")!.id;

    const { data: seasons } = await admin
      .from("seasons")
      .select("id, season_number")
      .eq("show_id", showId);
    for (const s of seasons!) seasonIds[s.season_number] = s.id;

    a = await createTestUser("ada");
    b = await createTestUser("ben");
  });

  afterAll(async () => {
    const created = [a, b].filter(Boolean);
    if (created.length) await deleteTestUsers(created);
  });

  async function clearEntries(user: TestUser) {
    await adminClient().from("library_entries").delete().eq("user_id", user.id);
  }

  describe("shape", () => {
    test("a movie entry defaults to backlog with play count 0", async () => {
      const { data, error } = await a.client
        .from("library_entries")
        .insert({ item_id: movieId, item_media_type: "movie" })
        .select()
        .single();
      expect(error).toBeNull();
      expect(data?.status).toBe("backlog");
      expect(data?.play_count).toBe(0);
      expect(data?.user_id).toBe(a.id);
      await clearEntries(a);
    });

    test("a show can't be tracked directly", async () => {
      const { error } = await a.client
        .from("library_entries")
        .insert({ item_id: showId, item_media_type: "show" });
      expect(error?.code).toBe("23514");
    });

    test("an entry points at an item or a season, not both", async () => {
      const { error } = await a.client.from("library_entries").insert({
        item_id: movieId,
        item_media_type: "movie",
        season_id: seasonIds[1],
      });
      expect(error?.code).toBe("23514");
    });

    test("an entry points at something", async () => {
      const { error } = await a.client.from("library_entries").insert({});
      expect(error?.code).toBe("23514");
    });

    test("up next is only for backlog entries", async () => {
      // The database clears a place sent with any other status...
      const { data, error } = await a.client
        .from("library_entries")
        .insert({ item_id: movieId, item_media_type: "movie", status: "finished", up_next_position: 1 })
        .select("id, up_next_position")
        .single();
      expect(error).toBeNull();
      expect(data?.up_next_position).toBeNull();
      // ...and refuses one set on its own.
      const { error: placed } = await a.client
        .from("library_entries")
        .update({ up_next_position: 1 })
        .eq("id", data!.id);
      expect(placed?.code).toBe("23514");
      await clearEntries(a);
    });

    test("play count can't be negative", async () => {
      const { error } = await a.client.from("library_entries").insert({
        item_id: movieId,
        item_media_type: "movie",
        play_count: -1,
      });
      expect(error?.code).toBe("23514");
    });
  });

  test("INV-008: no duplicate entries", async () => {
    const movie = { item_id: movieId, item_media_type: "movie" as const };
    const first = await a.client.from("library_entries").insert(movie);
    expect(first.error).toBeNull();
    const second = await a.client.from("library_entries").insert(movie);
    expect(second.error?.code).toBe("23505");

    const s2 = { season_id: seasonIds[2] };
    expect((await a.client.from("library_entries").insert(s2)).error).toBeNull();
    const s2again = await a.client.from("library_entries").insert(s2);
    expect(s2again.error?.code).toBe("23505");

    const s1 = await a.client
      .from("library_entries")
      .insert({ season_id: seasonIds[1] });
    expect(s1.error).toBeNull();
    await clearEntries(a);
  });

  test("INV-001: nobody writes another user's entries", async () => {
    const { data: entry, error } = await a.client
      .from("library_entries")
      .insert({ item_id: movieId, item_media_type: "movie" })
      .select()
      .single();
    expect(error).toBeNull();

    const forged = await b.client
      .from("library_entries")
      .insert({ user_id: a.id, season_id: seasonIds[1] });
    expect(forged.error?.code).toBe("42501");

    const updated = await b.client
      .from("library_entries")
      .update({ status: "finished" })
      .eq("id", entry!.id)
      .select();
    expect(updated.error).toBeNull();
    expect(updated.data).toHaveLength(0);

    const deleted = await b.client
      .from("library_entries")
      .delete()
      .eq("id", entry!.id)
      .select();
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(0);

    const { data: still } = await a.client
      .from("library_entries")
      .select("status")
      .eq("id", entry!.id)
      .single();
    expect(still?.status).toBe("backlog");
    await clearEntries(a);
  });

  test("INV-002: public by default, hidden when private", async () => {
    const { error } = await a.client
      .from("library_entries")
      .insert({ item_id: movieId, item_media_type: "movie" });
    expect(error).toBeNull();

    const countFor = async (client: TestUser["client"]) => {
      const { data } = await client
        .from("library_entries")
        .select("id")
        .eq("user_id", a.id);
      return data?.length;
    };

    expect(await countFor(anonClient())).toBe(1);
    expect(await countFor(b.client)).toBe(1);

    try {
      await adminClient()
        .from("profiles")
        .update({ library_private: true })
        .eq("id", a.id);
      expect(await countFor(anonClient())).toBe(0);
      expect(await countFor(b.client)).toBe(0);
      expect(await countFor(a.client)).toBe(1);
    } finally {
      await adminClient()
        .from("profiles")
        .update({ library_private: false })
        .eq("id", a.id);
      await clearEntries(a);
    }
  });

  test("INV-003: the catalogue can't delete a tracked season", async () => {
    const { error } = await a.client
      .from("library_entries")
      .insert({ season_id: seasonIds[3] });
    expect(error).toBeNull();

    const del = await adminClient()
      .from("seasons")
      .delete()
      .eq("id", seasonIds[3]);
    expect(del.error?.code).toBe("23503");

    const { data } = await a.client
      .from("library_entries")
      .select("id")
      .eq("season_id", seasonIds[3]);
    expect(data).toHaveLength(1);
    await clearEntries(a);
  });
});
