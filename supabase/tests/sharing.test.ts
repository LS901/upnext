// Sharing: the library privacy switch, public profiles, private notes and named
// lists. Others (a second user and a signed-out visitor) only ever read, and only
// what the owner left public (INV-002): a private library hides its entries, its
// manual items, its lists and their entries; a private list hides itself; notes
// are never readable by anyone else. Nobody writes another user's lists (INV-001).
// Every "can't see" assertion filters to the rows this file made, so leftovers
// from other runs (e2e users with public notes and lists) can't change the result.
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { getMyNotes, saveEntryNote } from "../../src/lib/library/notes";
import { getPublicLibrary } from "../../src/lib/library/public-library";
import { addEntryToList, getList, getPublicLists } from "../../src/lib/lists";
import { adminClient, anonClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const invented = () => String(randomInt(10_000_000, 99_999_999));

describe("sharing", () => {
  let a: TestUser;
  let b: TestUser;
  let aName: string;
  const itemIds: string[] = [];
  const movie: string[] = [];
  let seasonId: string;
  const manualIds: string[] = [];

  beforeAll(async () => {
    const admin = adminClient();
    const { data: items, error } = await admin
      .from("items")
      .insert([
        { provider: "tmdb", media_type: "movie", provider_id: invented(), title: "Invented Sharing Film" },
        { provider: "tmdb", media_type: "movie", provider_id: invented(), title: "Invented Sharing Film Two" },
        { provider: "tmdb", media_type: "show", provider_id: invented(), title: "Invented Sharing Show" },
      ])
      .select("id, media_type");
    if (error) throw error;
    for (const i of items) {
      itemIds.push(i.id);
      if (i.media_type === "movie") movie.push(i.id);
    }
    const show = items.find((i) => i.media_type === "show")!.id;
    const { data: season, error: seasonError } = await admin
      .from("seasons")
      .insert({ show_id: show, season_number: 1 })
      .select("id")
      .single();
    if (seasonError) throw seasonError;
    seasonId = season.id;

    a = await createTestUser("share-a");
    b = await createTestUser("share-b");
    const { data: profile, error: profileError } = await admin.from("profiles").select("username").eq("id", a.id).single();
    if (profileError) throw profileError;
    aName = profile.username;
  });

  afterEach(async () => {
    const admin = adminClient();
    for (const user of [a, b].filter(Boolean)) {
      for (const table of ["lists", "entry_notes", "library_entries"] as const) {
        const { error } = await admin.from(table).delete().eq("user_id", user.id);
        expect(error).toBeNull();
      }
      const { error } = await admin.from("profiles").update({ library_private: false }).eq("id", user.id);
      expect(error).toBeNull();
    }
    if (manualIds.length) await admin.from("items").delete().in("id", manualIds.splice(0));
  });

  afterAll(async () => {
    const created = [a, b].filter(Boolean);
    if (created.length) await deleteTestUsers(created);
    if (itemIds.length) await adminClient().from("items").delete().in("id", itemIds);
  });

  const others = () => [
    { who: "a second user", client: b.client },
    { who: "a signed-out visitor", client: anonClient() },
  ];

  async function setPrivate(user: TestUser, value: boolean) {
    const { error } = await user.client.from("profiles").update({ library_private: value }).eq("id", user.id);
    expect(error).toBeNull();
  }

  type EntryFields = { item_id?: string; item_media_type?: "movie" | "other"; season_id?: string };
  async function addEntry(user: TestUser, fields: EntryFields) {
    const { data, error } = await user.client.from("library_entries").insert(fields).select("id").single();
    expect(error).toBeNull();
    return data!.id;
  }

  async function addManual(user: TestUser, title: string) {
    const { data, error } = await user.client
      .from("items")
      .insert({ provider: "manual", media_type: "other", provider_id: randomUUID(), title, owner_id: user.id })
      .select("id")
      .single();
    expect(error).toBeNull();
    manualIds.push(data!.id);
    return data!.id;
  }

  async function makeList(user: TestUser, name: string, isPrivate = false) {
    const { data, error } = await user.client.from("lists").insert({ name, is_private: isPrivate }).select("id").single();
    expect(error).toBeNull();
    return data!.id;
  }

  async function put(user: TestUser, listId: string, entryId: string) {
    await addEntryToList(user.client, user.id, listId, entryId);
  }

  // A's library: a movie, a season, a manual item, a public list holding all three, and a note.
  async function seedA() {
    const film = await addEntry(a, { item_id: movie[0], item_media_type: "movie" });
    const season = await addEntry(a, { season_id: seasonId });
    const manualItem = await addManual(a, "Invented Secret Own Title");
    const manual = await addEntry(a, { item_id: manualItem, item_media_type: "other" });
    const list = await makeList(a, "Invented Halloween 2026");
    for (const entry of [film, season, manual]) await put(a, list, entry);
    const { error } = await a.client.from("entry_notes").insert({ entry_id: film, body: "Invented private note text" });
    expect(error).toBeNull();
    return { film, season, manual, manualItem, list };
  }

  async function visible(client: TestUser["client"], seed: Awaited<ReturnType<typeof seedA>>) {
    const entries = await client.from("library_entries").select("id").eq("user_id", a.id);
    const manual = await client.from("items").select("id, title").eq("id", seed.manualItem);
    const lists = await client.from("lists").select("id, name").eq("id", seed.list);
    const listEntries = await client.from("list_entries").select("entry_id").eq("list_id", seed.list);
    for (const r of [entries, manual, lists, listEntries]) expect(r.error).toBeNull();
    return {
      entries: entries.data!.length,
      manual: manual.data!.length,
      lists: lists.data!.length,
      listEntries: listEntries.data!.length,
    };
  }

  test("INV-002: a private library hides entries, manual items, lists and list entries from a second user and anon", async () => {
    const seed = await seedA();

    // Public (the default): others read the library, its manual title, the list and its entries.
    for (const { who, client } of others()) {
      expect(await visible(client, seed), who).toEqual({ entries: 3, manual: 1, lists: 1, listEntries: 3 });
      const view = await getPublicLibrary(client, aName);
      expect(view, who).not.toBeNull();
      expect(JSON.stringify(view), who).toContain("Invented Secret Own Title");
      expect((await getPublicLists(client, aName)).map((l) => l.id), who).toEqual([seed.list]);
      expect((await getList(client, seed.list))?.entries.map((e) => e.entryId).sort(), who).toEqual(
        [seed.film, seed.season, seed.manual].sort(),
      );
    }

    // The owner switches the library to private: others see nothing at all, through any table.
    await setPrivate(a, true);
    for (const { who, client } of others()) {
      expect(await visible(client, seed), who).toEqual({ entries: 0, manual: 0, lists: 0, listEntries: 0 });
      expect(await getPublicLibrary(client, aName), who).toBeNull();
      expect(await getPublicLists(client, aName), who).toEqual([]);
      expect(await getList(client, seed.list), who).toBeNull();
    }
    // The owner still has everything.
    expect(await visible(a.client, seed)).toEqual({ entries: 3, manual: 1, lists: 1, listEntries: 3 });
    expect((await getList(a.client, seed.list))?.entries).toHaveLength(3);

    // And switching back shows it again.
    await setPrivate(a, false);
    for (const { who, client } of others()) {
      expect(await visible(client, seed), who).toEqual({ entries: 3, manual: 1, lists: 1, listEntries: 3 });
    }
  });

  test("a private library and an unknown username look the same", async () => {
    await seedA();
    await setPrivate(a, true);
    for (const { client } of others()) {
      expect(await getPublicLibrary(client, aName)).toBeNull();
      expect(await getPublicLibrary(client, `user-unknown-${invented()}`)).toBeNull();
      expect(await getPublicLists(client, `user-unknown-${invented()}`)).toEqual([]);
    }
    // Even the owner's own profile says nothing while it's private: it shows what others see.
    expect(await getPublicLibrary(a.client, aName)).toBeNull();
  });

  test("INV-002: a public library with a private list hides only that list", async () => {
    const seed = await seedA();
    const hidden = await makeList(a, "Invented Private Picks", true);
    await put(a, hidden, seed.film);

    for (const { who, client } of others()) {
      expect(await visible(client, seed), who).toEqual({ entries: 3, manual: 1, lists: 1, listEntries: 3 });
      const list = await client.from("lists").select("id").eq("id", hidden);
      expect(list.error).toBeNull();
      expect(list.data, who).toEqual([]);
      const entries = await client.from("list_entries").select("entry_id").eq("list_id", hidden);
      expect(entries.error).toBeNull();
      expect(entries.data, who).toEqual([]);
      expect(await getList(client, hidden), who).toBeNull();
      expect((await getPublicLists(client, aName)).map((l) => l.id), who).toEqual([seed.list]);
    }
    // The profile's lists are the public ones, even for the owner looking at it.
    expect((await getPublicLists(a.client, aName)).map((l) => l.id)).toEqual([seed.list]);
    expect((await getList(a.client, hidden))?.isPrivate).toBe(true);
  });

  test("INV-002: notes are never readable by anyone else, whatever the privacy", async () => {
    const seed = await seedA();
    for (const isPrivate of [false, true]) {
      await setPrivate(a, isPrivate);
      for (const { who, client } of others()) {
        const notes = await client.from("entry_notes").select("body").eq("entry_id", seed.film);
        expect(notes.error).toBeNull();
        expect(notes.data, `${who}, private ${isPrivate}`).toEqual([]);
        const byUser = await client.from("entry_notes").select("body").eq("user_id", a.id);
        expect(byUser.error).toBeNull();
        expect(byUser.data, `${who}, private ${isPrivate}`).toEqual([]);
        // The public profile and the public list never carry it either.
        expect(JSON.stringify(await getPublicLibrary(client, aName))).not.toContain("Invented private note text");
        expect(JSON.stringify(await getList(client, seed.list))).not.toContain("Invented private note text");
      }
    }
    const own = await a.client.from("entry_notes").select("body").eq("entry_id", seed.film);
    expect(own.data).toEqual([{ body: "Invented private note text" }]);
  });

  test("INV-001: no one adds another user's entry to their list, or adds to another user's list", async () => {
    const seed = await seedA();
    const bEntry = await addEntry(b, { item_id: movie[1], item_media_type: "movie" });
    const bList = await makeList(b, "Invented Ben List");

    // B's list, A's entry; A's list, B's entry; A's list, A's entry (already there,
    // so a weaker check would answer 23505 and say so): all refused alike.
    for (const row of [
      { list_id: bList, entry_id: seed.film },
      { list_id: seed.list, entry_id: bEntry },
      { list_id: seed.list, entry_id: seed.film },
      { list_id: seed.list, entry_id: seed.manual },
    ]) {
      const { error } = await b.client.from("list_entries").insert({ ...row, position: 1 });
      expect(error?.code, JSON.stringify(row)).toBe("42501");
    }
    // A list made for A by B.
    const forged = await b.client.from("lists").insert({ name: "Invented Forged", user_id: a.id });
    expect(forged.error?.code).toBe("42501");

    // B can't rename, hide, delete or empty A's list (no rows change), nor move their list to A.
    const renamed = await b.client.from("lists").update({ name: "hijack" }).eq("id", seed.list).select();
    expect(renamed.data).toEqual([]);
    const hidden = await b.client.from("lists").update({ is_private: true }).eq("id", seed.list).select();
    expect(hidden.data).toEqual([]);
    const moved = await b.client.from("lists").update({ user_id: a.id }).eq("id", bList).select();
    expect(moved.error?.code).toBe("42501");
    const removed = await b.client.from("list_entries").delete().eq("list_id", seed.list).select();
    expect(removed.data).toEqual([]);
    const deleted = await b.client.from("lists").delete().eq("id", seed.list).select();
    expect(deleted.data).toEqual([]);

    const after = await getList(a.client, seed.list);
    expect(after?.name).toBe("Invented Halloween 2026");
    expect(after?.isPrivate).toBe(false);
    expect(after?.entries).toHaveLength(3);

    // The helper refuses too, and adds nothing.
    await expect(addEntryToList(b.client, b.id, seed.list, bEntry)).rejects.toThrow();
    await expect(addEntryToList(b.client, b.id, bList, seed.film)).rejects.toThrow();
    const bRows = await adminClient().from("list_entries").select("entry_id").eq("list_id", bList);
    expect(bRows.data).toEqual([]);
  });

  test("a double add gives one row, and a new entry goes at the end", async () => {
    const first = await addEntry(a, { item_id: movie[0], item_media_type: "movie" });
    const second = await addEntry(a, { item_id: movie[1], item_media_type: "movie" });
    const list = await makeList(a, "Invented Double");

    await Promise.all([put(a, list, first), put(a, list, first)]);
    await put(a, list, first);
    await put(a, list, second);

    const { data, error } = await adminClient()
      .from("list_entries")
      .select("entry_id, position")
      .eq("list_id", list)
      .order("position");
    expect(error).toBeNull();
    expect(data!.map((r) => r.entry_id)).toEqual([first, second]);
    expect(data![1].position).toBeGreaterThan(data![0].position);
    expect((await getList(a.client, list))?.entries.map((e) => e.entryId)).toEqual([first, second]);
  });

  test("deleting an entry removes it from its lists, and the list stays", async () => {
    const seed = await seedA();
    const { error } = await a.client.from("library_entries").delete().eq("id", seed.film);
    expect(error).toBeNull();
    const { data } = await adminClient().from("list_entries").select("entry_id").eq("list_id", seed.list);
    expect(data!.map((r) => r.entry_id).sort()).toEqual([seed.season, seed.manual].sort());
    expect(await getList(a.client, seed.list)).not.toBeNull();
  });

  test("a list's name is 1 to 80 characters, not counting the spaces around it", async () => {
    for (const name of ["", "   ", "x".repeat(81)]) {
      const { error } = await a.client.from("lists").insert({ name });
      expect(error?.code, JSON.stringify(name)).toBe("23514");
    }
    await makeList(a, "x".repeat(80));
    await makeList(a, "<b>Invented</b> 🎃");
  });

  test("a note holds up to 2000 characters", async () => {
    const entry = await addEntry(a, { item_id: movie[0], item_media_type: "movie" });
    const tooLong = await a.client.from("entry_notes").insert({ entry_id: entry, body: "n".repeat(2001) });
    expect(tooLong.error?.code).toBe("23514");
    const exact = await a.client.from("entry_notes").insert({ entry_id: entry, body: "n".repeat(2000) });
    expect(exact.error).toBeNull();
  });

  test("saveEntryNote writes, replaces and (when empty) deletes the owner's note, and never another user's", async () => {
    const entry = await addEntry(a, { item_id: movie[0], item_media_type: "movie" });
    const read = async () => (await adminClient().from("entry_notes").select("body, user_id").eq("entry_id", entry)).data;

    await saveEntryNote(a.client, a.id, entry, "Invented first thought");
    expect(await read()).toEqual([{ body: "Invented first thought", user_id: a.id }]);
    await saveEntryNote(a.client, a.id, entry, "Invented second thought");
    expect(await read()).toEqual([{ body: "Invented second thought", user_id: a.id }]);
    expect((await getMyNotes(a.client, a.id)).get(entry)).toBe("Invented second thought");

    // B can't write, replace or delete it (a write is refused before the note's key could answer).
    await expect(saveEntryNote(b.client, b.id, entry, "hijack")).rejects.toThrow();
    await saveEntryNote(b.client, b.id, entry, "");
    expect(await read()).toEqual([{ body: "Invented second thought", user_id: a.id }]);
    expect((await getMyNotes(b.client, b.id)).size).toBe(0);

    await saveEntryNote(a.client, a.id, entry, "");
    expect(await read()).toEqual([]);
    // Deleting a note that's gone is a quiet success.
    await saveEntryNote(a.client, a.id, entry, "");
  });

  test("a deleted user's lists go with them", async () => {
    const c = await createTestUser("share-c");
    const { data, error } = await c.client.from("lists").insert({ name: "Invented Gone" }).select("id").single();
    expect(error).toBeNull();
    // With an Other entry on the list: the user, their item, entry and list all go together.
    const item = await addManual(c, "Invented Gone Thing");
    const entry = await addEntry(c, { item_id: item, item_media_type: "other" });
    await put(c, data!.id, entry);
    await deleteTestUsers([c]);
    const left = await adminClient().from("lists").select("id").eq("id", data!.id);
    expect(left.data).toEqual([]);
  });
});
