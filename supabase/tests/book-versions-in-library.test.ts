// bookVersionsInLibrary reads through the user's own client, where other users'
// public entries are readable too. It must count only the user's own entries,
// per version, and a second entry for the same version must be refused (23505)
// while the other version still adds (Review Focus 3).
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { bookVersionsInLibrary } from "../../src/lib/library/in-library";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

let a: TestUser;
let b: TestUser;
// Invented ids no seed or e2e fixture uses.
const bookId = String(randomInt(10_000_000, 99_999_999));
const otherBookId = String(randomInt(10_000_000, 99_999_999));
const itemIds: string[] = [];
let bookItem = "";

beforeAll(async () => {
  const { data: items, error } = await adminClient()
    .from("items")
    .insert([
      { provider: "hardcover", media_type: "book", provider_id: bookId, title: "Invented Versions Book" },
      { provider: "hardcover", media_type: "book", provider_id: otherBookId, title: "Invented Other Book" },
    ])
    .select("id, provider_id");
  if (error) throw error;
  itemIds.push(...items.map((i) => i.id));
  bookItem = items.find((i) => i.provider_id === bookId)!.id;

  a = await createTestUser("bookver-a");
  b = await createTestUser("bookver-b");
  const added = await b.client
    .from("library_entries")
    .insert([
      { item_id: bookItem, item_media_type: "book", book_version: "print" },
      { item_id: bookItem, item_media_type: "book", book_version: "audio" },
    ]);
  if (added.error) throw added.error;
});

afterAll(async () => {
  if (itemIds.length) {
    await adminClient().from("library_entries").delete().in("item_id", itemIds);
    await adminClient().from("items").delete().in("id", itemIds);
  }
  await deleteTestUsers([a, b].filter(Boolean));
});

test("another user's public entries don't count as your versions", async () => {
  const { data: visible } = await a.client.from("library_entries").select("id").eq("user_id", b.id);
  expect(visible?.length).toBe(2); // readable, so the filter is what keeps them out
  expect(await bookVersionsInLibrary(a.client, a.id, [bookId, otherBookId])).toEqual(new Map());
});

test("the user's own versions are reported per book", async () => {
  expect(await bookVersionsInLibrary(b.client, b.id, [bookId, otherBookId])).toEqual(
    new Map([[bookId, new Set(["print", "audio"])]]),
  );
  expect(await bookVersionsInLibrary(b.client, b.id, [])).toEqual(new Map());
  expect(await bookVersionsInLibrary(b.client, b.id, ["1"])).toEqual(new Map());
});

test("the same version twice is refused with 23505, and the other version still adds", async () => {
  const entry = { item_id: bookItem, item_media_type: "book" as const };
  const first = await a.client.from("library_entries").insert({ ...entry, book_version: "audio" });
  expect(first.error).toBeNull();
  const again = await a.client.from("library_entries").insert({ ...entry, book_version: "audio" });
  expect(again.error?.code).toBe("23505");

  expect(await bookVersionsInLibrary(a.client, a.id, [bookId])).toEqual(new Map([[bookId, new Set(["audio"])]]));
  const print = await a.client.from("library_entries").insert({ ...entry, book_version: "print" });
  expect(print.error).toBeNull();
  expect(await bookVersionsInLibrary(a.client, a.id, [bookId])).toEqual(
    new Map([[bookId, new Set(["audio", "print"])]]),
  );
});
