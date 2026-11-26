import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from "./helpers";

const SEEDED = [
  "Harbour Lights",
  "Lanterns Over Kesh",
  "The Quiet Orchard",
  "Tidewright",
];

describe("catalogue", () => {
  let a: TestUser;

  beforeAll(async () => {
    a = await createTestUser("ada");
  });

  afterAll(async () => {
    if (a) await deleteTestUsers([a]);
  });

  async function itemId(title: string): Promise<string> {
    const { data, error } = await adminClient()
      .from("items")
      .select("id")
      .eq("title", title)
      .single();
    expect(error).toBeNull();
    return data!.id;
  }

  test("anyone can read the catalogue", async () => {
    const anon = anonClient();
    const { data: items, error } = await anon
      .from("items")
      .select("id, title")
      .in("title", SEEDED);
    expect(error).toBeNull();
    expect(items?.map((i) => i.title).sort()).toEqual(SEEDED);

    const show = items!.find((i) => i.title === "Harbour Lights")!;
    const { data: seasons, error: seasonsError } = await anon
      .from("seasons")
      .select("season_number")
      .eq("show_id", show.id)
      .order("season_number");
    expect(seasonsError).toBeNull();
    expect(seasons?.map((s) => s.season_number)).toEqual([1, 2, 3]);
  });

  test("nobody but the service role writes the catalogue", async () => {
    const id = await itemId("Tidewright");
    for (const client of [anonClient(), a.client]) {
      const { error } = await client.from("items").insert({
        media_type: "game",
        provider: "igdb",
        provider_id: "intruder",
        title: "Intruder",
      });
      expect(error?.code).toBe("42501");

      const { data: updated, error: updateError } = await client
        .from("items")
        .update({ title: "Hacked" })
        .eq("id", id)
        .select();
      expect(updateError).toBeNull();
      expect(updated).toHaveLength(0);

      const { data: deleted, error: deleteError } = await client
        .from("items")
        .delete()
        .eq("id", id)
        .select();
      expect(deleteError).toBeNull();
      expect(deleted).toHaveLength(0);
    }

    const { data: row } = await adminClient()
      .from("items")
      .select("title")
      .eq("id", id)
      .single();
    expect(row?.title).toBe("Tidewright");
  });

  test("a season can only belong to a show", async () => {
    const { error } = await adminClient()
      .from("seasons")
      .insert({ show_id: await itemId("The Quiet Orchard"), season_number: 1 });
    expect(error?.code).toBe("23503");
  });

  test("season numbers are unique per show", async () => {
    const { error } = await adminClient()
      .from("seasons")
      .insert({ show_id: await itemId("Harbour Lights"), season_number: 1 });
    expect(error?.code).toBe("23505");
  });
});
