// "Watched again": the update the playAgain action sends, through the user's own client.
// It names the count the page showed, so a repeat finds no row and changes nothing.
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const invented = () => String(randomInt(10_000_000, 99_999_999));

describe("play count", () => {
  let user: TestUser;
  let other: TestUser;
  let itemId: string;

  const addFinished = async (u: TestUser) => {
    const { data, error } = await u.client
      .from("library_entries")
      .insert({ item_id: itemId, item_media_type: "movie", status: "finished" })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const playAgain = async (u: TestUser, entryId: string, expected: number) => {
    const { data, error } = await u.client
      .from("library_entries")
      .update({ play_count: expected + 1 })
      .eq("id", entryId)
      .eq("user_id", u.id)
      .eq("play_count", expected)
      .eq("status", "finished")
      .select("id");
    if (error) throw error;
    return data.length;
  };
  const read = async (entryId: string) => {
    const { data, error } = await adminClient()
      .from("library_entries")
      .select("play_count, finished_at")
      .eq("id", entryId)
      .single();
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    const { data, error } = await adminClient()
      .from("items")
      .insert({ provider: "tmdb", media_type: "movie", provider_id: invented(), title: "Invented Again Film" })
      .select("id")
      .single();
    if (error) throw error;
    itemId = data.id;
    user = await createTestUser("play-count");
    other = await createTestUser("play-count-other");
  });

  afterAll(async () => {
    await deleteTestUsers([user, other].filter(Boolean));
    if (itemId) await adminClient().from("items").delete().eq("id", itemId);
  });

  test("raises the count by one and leaves finished_at alone", async () => {
    const id = await addFinished(user);
    const before = await read(id);
    expect(before.play_count).toBe(0);
    expect(await playAgain(user, id, 0)).toBe(1);
    const after = await read(id);
    expect(after.play_count).toBe(1);
    expect(after.finished_at).toBe(before.finished_at);
  });

  test("two calls with the same expected count raise it once", async () => {
    const id = await addFinished(other);
    expect(await playAgain(other, id, 0)).toBe(1);
    expect(await playAgain(other, id, 0)).toBe(0);
    expect((await read(id)).play_count).toBe(1);
  });

  test("never changes another user's entry", async () => {
    const { data } = await adminClient().from("library_entries").select("id").eq("user_id", user.id).single();
    const id = data!.id;
    const before = (await read(id)).play_count;
    expect(await playAgain(other, id, before)).toBe(0);
    expect((await read(id)).play_count).toBe(before);
  });

  test("does nothing on an entry that isn't finished", async () => {
    const { data: item, error: itemError } = await adminClient()
      .from("items")
      .insert({ provider: "tmdb", media_type: "movie", provider_id: invented(), title: "Invented Unfinished Film" })
      .select("id")
      .single();
    if (itemError) throw itemError;
    try {
      const { data, error } = await user.client
        .from("library_entries")
        .insert({ item_id: item.id, item_media_type: "movie", status: "in_progress" })
        .select("id")
        .single();
      if (error) throw error;
      expect(await playAgain(user, data.id, 0)).toBe(0);
      expect((await read(data.id)).play_count).toBe(0);
    } finally {
      await adminClient().from("items").delete().eq("id", item.id);
    }
  });
});
