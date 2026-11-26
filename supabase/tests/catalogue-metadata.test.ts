import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  adminClient,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from "./helpers";

describe("catalogue metadata", () => {
  let a: TestUser;
  const created: string[] = [];

  beforeAll(async () => {
    a = await createTestUser("ada");
  });

  afterEach(async () => {
    if (created.length) {
      await adminClient().from("items").delete().in("id", created);
      created.length = 0;
    }
  });

  afterAll(async () => {
    if (a) await deleteTestUsers([a]);
  });

  async function insertItem(row: Record<string, unknown>) {
    const { data, error } = await adminClient()
      .from("items")
      .insert({
        media_type: "movie",
        provider: "tmdb",
        provider_id: `meta-${crypto.randomUUID()}`,
        title: "Metadata Probe",
        ...row,
      })
      .select()
      .single();
    expect(error).toBeNull();
    created.push(data!.id);
    return data!;
  }

  test("the catalogue holds provider metadata", async () => {
    const item = await insertItem({
      image_ref: "/probe.jpg",
      release_date: "2020-05-17",
      runtime_minutes: 118,
      score: 87.5,
      score_count: 1234,
      ttb_hastily_s: 36000,
      ttb_normally_s: 54000,
      ttb_completely_s: 108000,
      ttb_count: 42,
    });
    const { data, error } = await adminClient()
      .from("items")
      .select("*")
      .eq("id", item.id)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      image_ref: "/probe.jpg",
      release_date: "2020-05-17",
      runtime_minutes: 118,
      score: 87.5,
      score_count: 1234,
      ttb_hastily_s: 36000,
      ttb_normally_s: 54000,
      ttb_completely_s: 108000,
      ttb_count: 42,
    });
  });

  test("a season holds episode count, runtime and air date", async () => {
    const show = await insertItem({ media_type: "show" });
    const { data, error } = await adminClient()
      .from("seasons")
      .insert({
        show_id: show.id,
        season_number: 1,
        episode_count: 8,
        runtime_minutes: 360,
        air_date: "2021-01-02",
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      episode_count: 8,
      runtime_minutes: 360,
      air_date: "2021-01-02",
    });
    expect(data!.updated_at).toBeTruthy();
  });

  test("updated_at moves on update", async () => {
    const item = await insertItem({});
    await new Promise((r) => setTimeout(r, 20));
    const { data, error } = await adminClient()
      .from("items")
      .update({ title: "Renamed Probe" })
      .eq("id", item.id)
      .select()
      .single();
    expect(error).toBeNull();
    expect(new Date(data!.updated_at).getTime()).toBeGreaterThan(
      new Date(item.updated_at).getTime(),
    );
  });

  test("unknown values stay null", async () => {
    const item = await insertItem({});
    expect(item).toMatchObject({
      image_ref: null,
      release_date: null,
      runtime_minutes: null,
      score: null,
      score_count: null,
      ttb_hastily_s: null,
      ttb_normally_s: null,
      ttb_completely_s: null,
      ttb_count: null,
    });
    expect(item.refreshed_at).toBeTruthy();
  });

  test("users still can't write the catalogue", async () => {
    const item = await insertItem({ score: 50 });
    const { data: updated, error } = await a.client
      .from("items")
      .update({ score: 99 })
      .eq("id", item.id)
      .select();
    expect(error).toBeNull();
    expect(updated).toHaveLength(0);

    const { data: row } = await adminClient()
      .from("items")
      .select("score")
      .eq("id", item.id)
      .single();
    expect(row?.score).toBe(50);
  });
});
