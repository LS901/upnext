import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from "./helpers";

describe("notes and progress exclusions", () => {
  let a: TestUser;
  let b: TestUser;
  let movieId: string;
  const seasonIds: Record<number, string> = {};

  beforeAll(async () => {
    const admin = adminClient();
    const { data: items, error } = await admin
      .from("items")
      .select("id, title")
      .in("title", ["Lanterns Over Kesh", "Harbour Lights"]);
    expect(error).toBeNull();
    movieId = items!.find((i) => i.title === "Lanterns Over Kesh")!.id;
    const showId = items!.find((i) => i.title === "Harbour Lights")!.id;

    const { data: seasons, error: seasonsError } = await admin
      .from("seasons")
      .select("id, season_number")
      .eq("show_id", showId);
    expect(seasonsError).toBeNull();
    for (const s of seasons!) seasonIds[s.season_number] = s.id;

    a = await createTestUser("ada");
    b = await createTestUser("ben");
  });

  afterEach(async () => {
    const admin = adminClient();
    for (const user of [a, b].filter(Boolean)) {
      for (const table of [
        "entry_notes",
        "progress_exclusions",
        "library_entries",
      ] as const) {
        const { error } = await admin.from(table).delete().eq("user_id", user.id);
        expect(error).toBeNull();
      }
    }
  });

  afterAll(async () => {
    const created = [a, b].filter(Boolean);
    if (created.length) await deleteTestUsers(created);
  });

  async function setPrivate(user: TestUser, value: boolean) {
    const { error } = await adminClient()
      .from("profiles")
      .update({ library_private: value })
      .eq("id", user.id);
    expect(error).toBeNull();
  }

  async function addEntry(user: TestUser) {
    const { data, error } = await user.client
      .from("library_entries")
      .insert({ item_id: movieId, item_media_type: "movie" })
      .select()
      .single();
    expect(error).toBeNull();
    return data!;
  }

  test("INV-002: notes are only ever visible to their owner", async () => {
    try {
      await setPrivate(a, false);
      const entry = await addEntry(a);
      const { error: insertError } = await a.client
        .from("entry_notes")
        .insert({ entry_id: entry.id, body: "slow start, great end" });
      expect(insertError).toBeNull();

      const own = await a.client
        .from("entry_notes")
        .select()
        .eq("entry_id", entry.id);
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);

      const other = await b.client
        .from("entry_notes")
        .select()
        .eq("entry_id", entry.id);
      expect(other.error).toBeNull();
      expect(other.data).toHaveLength(0);

      const anon = await anonClient()
        .from("entry_notes")
        .select()
        .eq("entry_id", entry.id);
      expect(anon.error).toBeNull();
      expect(anon.data).toHaveLength(0);
    } finally {
      await setPrivate(a, false);
    }
  });

  test("INV-001: nobody writes another user's notes", async () => {
    const entry = await addEntry(a);
    // the same answer before and after A writes a note, so B can't probe
    // whether a note exists
    const attempts = async () => {
      const plain = await b.client
        .from("entry_notes")
        .insert({ entry_id: entry.id, body: "hijack" });
      expect(plain.error?.code).toBe("42501");
      const upsert = await b.client
        .from("entry_notes")
        .upsert({ entry_id: entry.id, body: "hijack" }, { onConflict: "entry_id" });
      expect(upsert.error?.code).toBe("42501");
    };
    await attempts();

    const { error: seed } = await a.client
      .from("entry_notes")
      .insert({ entry_id: entry.id, body: "mine" });
    expect(seed).toBeNull();
    await attempts();

    const forged = await b.client
      .from("entry_notes")
      .insert({ entry_id: entry.id, user_id: a.id, body: "hijack" });
    expect(forged.error?.code).toBe("42501");

    const updated = await b.client
      .from("entry_notes")
      .update({ body: "hijack" })
      .eq("entry_id", entry.id)
      .select();
    expect(updated.error).toBeNull();
    expect(updated.data).toHaveLength(0);

    const deleted = await b.client
      .from("entry_notes")
      .delete()
      .eq("entry_id", entry.id)
      .select();
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(0);

    const { data, error } = await a.client
      .from("entry_notes")
      .select()
      .eq("entry_id", entry.id)
      .single();
    expect(error).toBeNull();
    expect(data?.body).toBe("mine");
  });

  test("exclusions don't need an entry", async () => {
    const first = await a.client
      .from("progress_exclusions")
      .insert({ season_id: seasonIds[1] });
    expect(first.error).toBeNull();

    const again = await a.client
      .from("progress_exclusions")
      .insert({ season_id: seasonIds[1] });
    expect(again.error?.code).toBe("23505");
  });

  test("INV-002 for exclusions", async () => {
    try {
      await setPrivate(a, false);
      const { error } = await a.client
        .from("progress_exclusions")
        .insert({ season_id: seasonIds[1] });
      expect(error).toBeNull();

      for (const client of [b.client, anonClient()]) {
        const { data, error: readError } = await client
          .from("progress_exclusions")
          .select()
          .eq("user_id", a.id);
        expect(readError).toBeNull();
        expect(data).toHaveLength(1);
      }

      await setPrivate(a, true);
      for (const client of [b.client, anonClient()]) {
        const { data, error: readError } = await client
          .from("progress_exclusions")
          .select()
          .eq("user_id", a.id);
        expect(readError).toBeNull();
        expect(data).toHaveLength(0);
      }
    } finally {
      await setPrivate(a, false);
    }
  });

  test("INV-001 for exclusions", async () => {
    const { error: seed } = await a.client
      .from("progress_exclusions")
      .insert({ season_id: seasonIds[1] });
    expect(seed).toBeNull();

    const forged = await b.client
      .from("progress_exclusions")
      .insert({ user_id: a.id, season_id: seasonIds[2] });
    expect(forged.error?.code).toBe("42501");

    const deleted = await b.client
      .from("progress_exclusions")
      .delete()
      .eq("user_id", a.id)
      .select();
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(0);

    const { data, error } = await a.client.from("progress_exclusions").select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test("removing an exclusion leaves the entry alone", async () => {
    const { data: entry, error } = await a.client
      .from("library_entries")
      .insert({ season_id: seasonIds[2], status: "finished" })
      .select()
      .single();
    expect(error).toBeNull();

    const { error: excludeError } = await a.client
      .from("progress_exclusions")
      .insert({ season_id: seasonIds[2] });
    expect(excludeError).toBeNull();

    const { error: removeError } = await a.client
      .from("progress_exclusions")
      .delete()
      .eq("season_id", seasonIds[2]);
    expect(removeError).toBeNull();

    const { data: after, error: afterError } = await a.client
      .from("library_entries")
      .select()
      .eq("id", entry!.id)
      .single();
    expect(afterError).toBeNull();
    expect(after).toEqual(entry);
  });

  test("INV-003: the catalogue can't delete an excluded season", async () => {
    const { error } = await a.client
      .from("progress_exclusions")
      .insert({ season_id: seasonIds[3] });
    expect(error).toBeNull();

    const { error: deleteError } = await adminClient()
      .from("seasons")
      .delete()
      .eq("id", seasonIds[3]);
    expect(deleteError?.code).toBe("23503");
  });
});
