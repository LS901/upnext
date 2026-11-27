// Books schema: a print and an audio entry per book (INV-008 is one entry per item
// per version), series readable but never writable by users, and per-user book
// exclusions. All titles are invented.
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const invented = () => String(randomInt(10_000_000, 99_999_999));

describe("books schema", () => {
  let a: TestUser;
  let b: TestUser;
  let bookId: string;
  let movieId: string;
  let showId: string;
  let seasonId: string;
  let seriesId: string;

  beforeAll(async () => {
    const admin = adminClient();
    const { data: series, error: seriesError } = await admin
      .from("book_series")
      .insert({ provider: "hardcover", provider_id: invented(), name: "The Invented Saga", primary_books_count: 3 })
      .select("id")
      .single();
    if (seriesError) throw seriesError;
    seriesId = series.id;

    const { data: items, error } = await admin
      .from("items")
      .insert([
        {
          provider: "hardcover",
          media_type: "book",
          provider_id: invented(),
          title: "Invented Book One",
          page_count: 320,
          series_id: seriesId,
          series_position: 1,
        },
        { provider: "tmdb", media_type: "movie", provider_id: invented(), title: "Invented Book Film" },
        { provider: "tmdb", media_type: "show", provider_id: invented(), title: "Invented Book Show" },
      ])
      .select("id, media_type");
    if (error) throw error;
    bookId = items.find((i) => i.media_type === "book")!.id;
    movieId = items.find((i) => i.media_type === "movie")!.id;
    showId = items.find((i) => i.media_type === "show")!.id;

    const { data: season, error: seasonError } = await admin
      .from("seasons")
      .insert({ show_id: showId, season_number: 1 })
      .select("id")
      .single();
    if (seasonError) throw seasonError;
    seasonId = season.id;

    a = await createTestUser("books-a");
    b = await createTestUser("books-b");
  });

  afterAll(async () => {
    const admin = adminClient();
    await admin.from("book_exclusions").delete().eq("item_id", bookId);
    await deleteTestUsers([a, b].filter(Boolean));
    // The show's season goes with it (on delete cascade).
    await admin.from("items").delete().in("id", [bookId, movieId, showId].filter(Boolean));
    if (seriesId) await admin.from("book_series").delete().eq("id", seriesId);
  });

  const addBook = (user: TestUser, book_version?: "print" | "audio") =>
    user.client.from("library_entries").insert({ item_id: bookId, item_media_type: "book", book_version });

  test("a print and an audio entry of one book are both allowed", async () => {
    expect((await addBook(a, "print")).error).toBeNull();
    expect((await addBook(a, "audio")).error).toBeNull();
  });

  test("a second entry of the same version is a duplicate (23505)", async () => {
    expect((await addBook(a, "print")).error?.code).toBe("23505");
    expect((await addBook(a, "audio")).error?.code).toBe("23505");
  });

  test("a second entry for one movie still fails with 23505", async () => {
    const add = () => b.client.from("library_entries").insert({ item_id: movieId, item_media_type: "movie" });
    expect((await add()).error).toBeNull();
    expect((await add()).error?.code).toBe("23505");
  });

  test("a book entry needs a version, and a movie entry can't have one", async () => {
    expect((await addBook(b)).error?.code).toBe("23514");
    const movie = await b.client
      .from("library_entries")
      .insert({ item_id: movieId, item_media_type: "movie", book_version: "print" });
    expect(movie.error?.code).toBe("23514");
  });

  test("a season entry can't carry a book version, on insert or on update (23514)", async () => {
    const withVersion = await b.client.from("library_entries").insert({ season_id: seasonId, book_version: "print" });
    expect(withVersion.error?.code).toBe("23514");

    const plain = await b.client.from("library_entries").insert({ season_id: seasonId }).select("id").single();
    expect(plain.error).toBeNull();
    const update = await b.client
      .from("library_entries")
      .update({ book_version: "audio" })
      .eq("id", plain.data!.id)
      .select("book_version");
    expect(update.error?.code).toBe("23514");

    const { data } = await adminClient().from("library_entries").select("book_version").eq("id", plain.data!.id).single();
    expect(data?.book_version).toBeNull();
  });

  test("book_series is readable by a user's client and not writable", async () => {
    const read = await a.client.from("book_series").select("id, name").eq("id", seriesId);
    expect(read.error).toBeNull();
    expect(read.data).toHaveLength(1);

    const insert = await a.client.from("book_series").insert({ provider: "hardcover", provider_id: invented(), name: "Nope" });
    expect(insert.error).not.toBeNull();

    const update = await a.client.from("book_series").update({ name: "Changed" }).eq("id", seriesId).select();
    expect(update.data ?? []).toHaveLength(0);
    const del = await a.client.from("book_series").delete().eq("id", seriesId).select();
    expect(del.data ?? []).toHaveLength(0);
    const { data } = await adminClient().from("book_series").select("name").eq("id", seriesId).single();
    expect(data?.name).toBe("The Invented Saga");
  });

  test("book_exclusions: a user can add and remove their own row, and can't see another user's", async () => {
    const insert = await a.client.from("book_exclusions").insert({ item_id: bookId });
    expect(insert.error).toBeNull();

    const own = await a.client.from("book_exclusions").select("item_id");
    expect(own.data).toEqual([{ item_id: bookId }]);

    // Like progress_exclusions, rows follow the library's visibility: public by default,
    // hidden from others once the owner goes private.
    expect((await b.client.from("book_exclusions").select("item_id")).data).toEqual([{ item_id: bookId }]);
    await adminClient().from("profiles").update({ library_private: true }).eq("id", a.id);
    expect((await b.client.from("book_exclusions").select("item_id")).data).toEqual([]);

    const foreign = await b.client.from("book_exclusions").delete().eq("item_id", bookId).select();
    expect(foreign.data ?? []).toHaveLength(0);

    const removed = await a.client.from("book_exclusions").delete().eq("item_id", bookId).select();
    expect(removed.data).toHaveLength(1);
  });
});
