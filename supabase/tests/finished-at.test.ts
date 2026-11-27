// finished_at: when an entry moved into Finished (owner said, 2026-11-27). The database
// sets it, through a trigger, so every path that changes status gets it. Written here
// through the user's own client, as the app does; only the check test uses the admin client.
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const invented = () => String(randomInt(10_000_000, 99_999_999));

describe("finished_at", () => {
  let user: TestUser;
  const itemIds: string[] = [];
  const itemFor: Record<string, string> = {};

  const finishedAt = async (entryId: string) => {
    const { data, error } = await adminClient().from("library_entries").select("finished_at").eq("id", entryId).single();
    if (error) throw error;
    return data.finished_at;
  };
  const add = async (key: string, status?: "finished") => {
    const { data, error } = await user.client
      .from("library_entries")
      .insert({ item_id: itemFor[key], item_media_type: "movie", ...(status ? { status } : {}) })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const setStatus = async (entryId: string, status: "backlog" | "in_progress" | "finished") => {
    const { error } = await user.client.from("library_entries").update({ status }).eq("id", entryId);
    if (error) throw error;
  };

  beforeAll(async () => {
    const keys = ["added", "moved", "again", "edited", "check"];
    const { data, error } = await adminClient()
      .from("items")
      .insert(keys.map((k) => ({ provider: "tmdb" as const, media_type: "movie" as const, provider_id: invented(), title: `Invented Finish Film ${k}` })))
      .select("id, title");
    if (error) throw error;
    for (const row of data) {
      itemIds.push(row.id);
      itemFor[row.title.replace("Invented Finish Film ", "")] = row.id;
    }
    user = await createTestUser("finished-at");
  });

  afterAll(async () => {
    await deleteTestUsers([user].filter(Boolean));
    if (itemIds.length) await adminClient().from("items").delete().in("id", itemIds);
  });

  test("adding an entry as Finished stamps it", async () => {
    const id = await add("added", "finished");
    const stamp = await finishedAt(id);
    expect(stamp).not.toBeNull();
    expect(Date.now() - new Date(stamp!).getTime()).toBeLessThan(60_000);
  });

  test("moving into Finished stamps it; leaving clears it", async () => {
    const id = await add("moved");
    expect(await finishedAt(id)).toBeNull();
    await setStatus(id, "finished");
    expect(await finishedAt(id)).not.toBeNull();
    await setStatus(id, "in_progress");
    expect(await finishedAt(id)).toBeNull();
  });

  test("finishing again after a rewatch stamps a newer time", async () => {
    const id = await add("again");
    await setStatus(id, "finished");
    const first = await finishedAt(id);
    await setStatus(id, "in_progress");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await setStatus(id, "finished");
    const second = await finishedAt(id);
    expect(new Date(second!).getTime()).toBeGreaterThan(new Date(first!).getTime());
  });

  test("other edits keep the time", async () => {
    const id = await add("edited", "finished");
    const before = await finishedAt(id);
    const { error } = await user.client.from("library_entries").update({ play_count: 2 }).eq("id", id);
    if (error) throw error;
    // Saving the same status again isn't a new finish either.
    await setStatus(id, "finished");
    expect(await finishedAt(id)).toBe(before);
  });

  test("finished_at can't be set on an entry that isn't Finished", async () => {
    const id = await add("check");
    const { error } = await adminClient()
      .from("library_entries")
      .update({ finished_at: new Date().toISOString() })
      .eq("id", id);
    expect(error).not.toBeNull();
    expect(await finishedAt(id)).toBeNull();
  });
});
