// "Other": a user's own entries. The item is a manual row owned by one user, so its
// title obeys that user's library privacy (INV-002), and only the owner can write it.
// Every "can't see" assertion filters to the rows this file made, so leftovers from
// other runs (e2e users, other tests) can't change the result.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test, vi } from "vitest";
import { refreshStaleItems } from "../../src/lib/catalogue/refresh";
import { adminClient, anonClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

describe("manual items (Other)", () => {
  let owner: TestUser;
  let other: TestUser;
  const made: string[] = [];

  const setPrivate = async (value: boolean) => {
    const { error } = await adminClient().from("profiles").update({ library_private: value }).eq("id", owner.id);
    expect(error).toBeNull();
  };
  const manualItem = (u: TestUser, title: string, extra: Record<string, unknown> = {}) =>
    u.client
      .from("items")
      .insert({
        provider: "manual",
        media_type: "other",
        provider_id: randomUUID(),
        title,
        owner_id: u.id,
        ...extra,
      })
      .select("id")
      .single();
  const make = async (u: TestUser, title: string) => {
    const { data, error } = await manualItem(u, title);
    expect(error).toBeNull();
    made.push(data!.id);
    return data!.id;
  };

  beforeAll(async () => {
    owner = await createTestUser("manual-owner");
    other = await createTestUser("manual-other");
  });

  afterEach(async () => {
    const admin = adminClient();
    await admin.from("library_entries").delete().eq("user_id", owner.id);
    await admin.from("library_entries").delete().eq("user_id", other.id);
    if (made.length) await admin.from("items").delete().in("id", made.splice(0));
    await setPrivate(false);
  });

  afterAll(async () => {
    await deleteTestUsers([owner, other].filter(Boolean));
  });

  test("a user creates a manual item and its entry", async () => {
    const id = await make(owner, "Invented Channel Let's Play");
    const { data: entry, error } = await owner.client
      .from("library_entries")
      .insert({ item_id: id, item_media_type: "other", status: "backlog" })
      .select("id, up_next_position")
      .single();
    expect(error).toBeNull();
    expect(entry!.up_next_position).not.toBeNull();
    const { data: item } = await owner.client.from("items").select("title, length_note").eq("id", id).single();
    expect(item!.title).toBe("Invented Channel Let's Play");
  });

  test("the length note is optional and capped at 100 characters", async () => {
    const ok = await manualItem(owner, "Invented With Length", { length_note: "24 episodes" });
    expect(ok.error).toBeNull();
    made.push(ok.data!.id);
    const tooLong = await manualItem(owner, "Invented Too Long", { length_note: "x".repeat(101) });
    expect(tooLong.error).not.toBeNull();
    const exact = await manualItem(owner, "Invented Exactly 100", { length_note: "x".repeat(100) });
    expect(exact.error).toBeNull();
    made.push(exact.data!.id);
  });

  test("INV-002: with a private library, another user and anon can't read the title", async () => {
    const id = await make(owner, "Invented Private Show");
    await setPrivate(true);
    for (const client of [other.client, anonClient()]) {
      const { data, error } = await client.from("items").select("id, title").eq("id", id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    const { data } = await owner.client.from("items").select("title").eq("id", id);
    expect(data).toEqual([{ title: "Invented Private Show" }]);
  });

  test("with a public library, another user and anon can read the title", async () => {
    const id = await make(owner, "Invented Public Show");
    await setPrivate(false);
    for (const client of [other.client, anonClient()]) {
      const { data, error } = await client.from("items").select("title").eq("id", id);
      expect(error).toBeNull();
      expect(data).toEqual([{ title: "Invented Public Show" }]);
    }
  });

  test("INV-002: a private library's entry and title don't reach another user through an embed", async () => {
    const id = await make(owner, "Invented Embedded Secret");
    const { error } = await owner.client
      .from("library_entries")
      .insert({ item_id: id, item_media_type: "other", status: "finished" });
    expect(error).toBeNull();
    await setPrivate(true);
    for (const client of [other.client, anonClient()]) {
      const { data, error: readError } = await client
        .from("library_entries")
        .select("id, item:items(title)")
        .eq("user_id", owner.id);
      expect(readError).toBeNull();
      expect(data).toEqual([]);
    }
  });

  test("nobody but the owner can update or delete it", async () => {
    const id = await make(owner, "Invented Untouchable");
    for (const client of [other.client, anonClient()]) {
      const upd = await client.from("items").update({ title: "Hijacked" }).eq("id", id).select("id");
      expect(upd.data ?? []).toEqual([]);
      const del = await client.from("items").delete().eq("id", id).select("id");
      expect(del.data ?? []).toEqual([]);
    }
    const { data } = await adminClient().from("items").select("title").eq("id", id).single();
    expect(data!.title).toBe("Invented Untouchable");

    const own = await owner.client.from("items").update({ title: "Invented Renamed" }).eq("id", id).select("title");
    expect(own.data).toEqual([{ title: "Invented Renamed" }]);
    const gone = await owner.client.from("items").delete().eq("id", id).select("id");
    expect(gone.data).toEqual([{ id }]);
  });

  test("an owner can't hand a manual item to someone else", async () => {
    const id = await make(owner, "Invented Handover");
    const { error } = await owner.client.from("items").update({ owner_id: other.id }).eq("id", id);
    expect(error).not.toBeNull();
  });

  test("a user can't insert a manual item with another owner_id", async () => {
    const { error } = await manualItem(owner, "Invented Forged", { owner_id: other.id });
    expect(error).not.toBeNull();
    const { data } = await adminClient().from("items").select("id").eq("title", "Invented Forged");
    expect(data).toEqual([]);
  });

  test("a user can't insert a non-manual item", async () => {
    const attempts = [
      { provider: "tmdb", media_type: "movie", owner_id: null },
      { provider: "tmdb", media_type: "movie", owner_id: owner.id },
      { provider: "manual", media_type: "movie", owner_id: owner.id },
      { provider: "manual", media_type: "other", owner_id: null },
    ] as const;
    for (const a of attempts) {
      const { error } = await owner.client
        .from("items")
        .insert({ ...a, provider_id: randomUUID(), title: "Invented Not Allowed" });
      expect(error, JSON.stringify(a)).not.toBeNull();
    }
    const { data } = await adminClient().from("items").select("id").eq("title", "Invented Not Allowed");
    expect(data).toEqual([]);
  });

  test("the database ties manual, owned and other together", async () => {
    const admin = adminClient();
    const base = { title: "Invented Tied", provider_id: randomUUID() };
    const a = await admin.from("items").insert({ ...base, provider: "tmdb", media_type: "movie", owner_id: owner.id });
    expect(a.error).not.toBeNull();
    const b = await admin.from("items").insert({ ...base, provider: "manual", media_type: "movie", owner_id: owner.id });
    expect(b.error).not.toBeNull();
    const c = await admin.from("items").insert({ ...base, provider: "manual", media_type: "other", owner_id: null });
    expect(c.error).not.toBeNull();
    const d = await admin.from("items").insert({ ...base, provider: "tmdb", media_type: "other" });
    expect(d.error).not.toBeNull();
  });

  test("catalogue items are still readable by everyone", async () => {
    for (const client of [anonClient(), other.client]) {
      const { data, error } = await client.from("items").select("id").eq("title", "Lanterns Over Kesh");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
  });

  test("deleting the owner deletes their manual items", async () => {
    const temp = await createTestUser("manual-temp");
    const { data, error } = await manualItem(temp, "Invented Goes With Owner");
    expect(error).toBeNull();
    await deleteTestUsers([temp]);
    const { data: left } = await adminClient().from("items").select("id").eq("id", data!.id);
    expect(left).toEqual([]);
  });

  describe("refresh, purge and prune", () => {
    beforeEach(() => {
      const { url, serviceRoleKey } = inject("supabase");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);
      const real = globalThis.fetch;
      // Supabase passes through; a provider call fails the test.
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!target.startsWith(url)) throw new Error(`Unexpected provider call: ${new URL(target).host}`);
        return real(input, init);
      });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    test("the refresh skips a stale manual item, and the purge and prune leave it alone", async () => {
      const admin = adminClient();
      // Only this test's rows may be stale, so the counts are exact and no real provider is called.
      const now = new Date().toISOString();
      await admin.from("items").update({ refreshed_at: now }).lt("refreshed_at", daysAgo(1));
      await admin.from("items").update({ created_at: now }).lt("created_at", daysAgo(1));

      const id = await make(owner, "Invented Old Manual");
      const { error: entryError } = await owner.client
        .from("library_entries")
        .insert({ item_id: id, item_media_type: "other", status: "backlog" });
      expect(entryError).toBeNull();
      const aged = await admin
        .from("items")
        .update({ refreshed_at: daysAgo(200), created_at: daysAgo(200) })
        .eq("id", id);
      expect(aged.error).toBeNull();

      const result = await refreshStaleItems();
      expect(result).toEqual({ refreshed: 0, failed: 0, purged: 0, pruned: 0 });

      const { data } = await admin
        .from("items")
        .select("title, refresh_attempted_at, provider_data_purged_at")
        .eq("id", id)
        .single();
      expect(data).toEqual({ title: "Invented Old Manual", refresh_attempted_at: null, provider_data_purged_at: null });
    });
  });
});
