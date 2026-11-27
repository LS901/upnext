// Books in My library and Up next, read through the user's own client (which
// can read other users' public entries and exclusions too). Print and audio are
// separate entries; not-started books queue under Books, never with Movies; books
// in a status group sit under their series, whose progress counts each book once
// over all the user's entries (Review Focus 5), minus only the user's exclusions.
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  deleteEntry,
  getMyLibrary,
  setEntryStatus,
  type ItemRow,
  type LibraryView,
  type SeriesRow,
} from "../../src/lib/library/queries";
import { placeInUpNext } from "../../src/lib/library/up-next";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const invented = () => String(randomInt(10_000_000, 99_999_999));

const seriesIn = (view: LibraryView, status: string): SeriesRow[] =>
  (view.groups.find((g) => g.status === status)?.rows ?? []).filter((r): r is SeriesRow => r.kind === "series");

describe("books in My library", () => {
  let a: TestUser;
  let b: TestUser;
  let seriesId = "";
  const itemIds: string[] = [];
  const item: Record<string, string> = {};
  const entry: Record<string, string> = {};

  const add = async (user: TestUser, key: string, row: object) => {
    const { data, error } = await user.client.from("library_entries").insert(row).select("id").single();
    if (error) throw error;
    entry[key] = data.id;
  };
  const book = (key: string, version: "print" | "audio", status = "backlog") => ({
    item_id: item[key],
    item_media_type: "book",
    book_version: version,
    status,
  });

  beforeAll(async () => {
    const admin = adminClient();
    const { data: series, error: seriesError } = await admin
      .from("book_series")
      .insert({ provider: "hardcover", provider_id: invented(), name: "Invented Ember Cycle", primary_books_count: 3 })
      .select("id")
      .single();
    if (seriesError) throw seriesError;
    seriesId = series.id;

    const inSeries = (title: string, position: number, label: string | null = null) => ({
      provider: "hardcover" as const,
      media_type: "book" as const,
      provider_id: invented(),
      title,
      series_id: seriesId,
      series_position: position,
      series_position_label: label,
    });
    const { data: items, error } = await admin
      .from("items")
      .insert([
        {
          provider: "hardcover",
          media_type: "book",
          provider_id: invented(),
          title: "Invented Standalone Book",
          image_ref: "https://assets.hardcover.app/invented/standalone.jpg",
          page_count: 320,
          audio_minutes: 680,
          has_audiobook: true,
          narrators: "Invented Reader, Other Voice",
          score: 84,
          score_count: 1234,
        },
        inSeries("Invented Ember One", 1),
        inSeries("Invented Ember Two", 2),
        inSeries("Invented Ember Interlude", 2.5, "2.5"),
        inSeries("Invented Ember Three", 3),
        { provider: "tmdb", media_type: "movie", provider_id: invented(), title: "Invented Shelf Film" },
      ])
      .select("id, title");
    if (error) throw error;
    itemIds.push(...items.map((i) => i.id));
    const byTitle = new Map(items.map((i) => [i.title, i.id]));
    item.standalone = byTitle.get("Invented Standalone Book")!;
    item.one = byTitle.get("Invented Ember One")!;
    item.two = byTitle.get("Invented Ember Two")!;
    item.interlude = byTitle.get("Invented Ember Interlude")!;
    item.three = byTitle.get("Invented Ember Three")!;
    item.film = byTitle.get("Invented Shelf Film")!;

    a = await createTestUser("books-lib-a");
    b = await createTestUser("books-lib-b");
    // b's library is public (the default), so a's client can read all of this.
    await add(b, "bTwo", book("two", "print", "finished"));
    await add(b, "bThree", book("three", "audio", "finished"));
    const { error: bExcluded } = await b.client.from("book_exclusions").insert({ item_id: item.one });
    if (bExcluded) throw bExcluded;
  });

  afterAll(async () => {
    // Entries and exclusions go with their users; then the catalogue rows can.
    await deleteTestUsers([a, b].filter(Boolean));
    if (itemIds.length) await adminClient().from("items").delete().in("id", itemIds);
    if (seriesId) await adminClient().from("book_series").delete().eq("id", seriesId);
  });

  test("print and audio entries show as two rows in the Books queue", async () => {
    await add(a, "print", book("standalone", "print"));
    await add(a, "audio", book("standalone", "audio"));

    const { upNext, groups } = await getMyLibrary(a.client, a.id);
    expect(upNext.book).toEqual([
      {
        kind: "item",
        entryId: entry.print,
        status: "backlog",
        mediaType: "book",
        version: "print",
        title: "Invented Standalone Book",
        imageUrl: "https://assets.hardcover.app/invented/standalone.jpg",
        minutes: null,
        pages: 320,
        narrators: null,
        providerName: "hardcover",
        score: 84,
        scoreCount: 1234,
      },
      expect.objectContaining({
        entryId: entry.audio,
        version: "audio",
        title: "Invented Standalone Book",
        minutes: 680,
        pages: null,
        narrators: "Invented Reader, Other Voice",
      }),
    ]);
    expect(groups).toEqual([]);
  });

  test("the Books queue never mixes with Movies", async () => {
    await add(a, "film", { item_id: item.film, item_media_type: "movie" });
    const ids = async () => {
      const { upNext } = await getMyLibrary(a.client, a.id);
      return { movie: upNext.movie.map((r) => r.entryId), book: upNext.book.map((r) => r.entryId) };
    };
    expect(await ids()).toEqual({ movie: [entry.film], book: [entry.print, entry.audio] });

    // A target in another queue moves nothing, either way.
    await placeInUpNext(a.client, a.id, entry.audio, entry.film);
    await placeInUpNext(a.client, a.id, entry.film, entry.print);
    expect(await ids()).toEqual({ movie: [entry.film], book: [entry.print, entry.audio] });
    // Within Books, print and audio reorder like any queue.
    await placeInUpNext(a.client, a.id, entry.audio, entry.print);
    expect(await ids()).toEqual({ movie: [entry.film], book: [entry.audio, entry.print] });
  });

  test("books in a status sit under their series, whose progress counts every entry, each book once", async () => {
    // Book 1 Finished in both versions (Review Focus 5), book 2 in progress, the
    // 2.5 interlude Finished (not main-line), book 3 not started (queued).
    await add(a, "onePrint", book("one", "print", "finished"));
    await add(a, "oneAudio", book("one", "audio", "finished"));
    await add(a, "twoPrint", book("two", "print", "in_progress"));
    await add(a, "interlude", book("interlude", "print", "finished"));
    await add(a, "threeAudio", book("three", "audio"));

    const view = await getMyLibrary(a.client, a.id);
    expect(view.groups.map((g) => g.status)).toEqual(["in_progress", "finished"]);

    // b's finished books and b's exclusion of book 1 never count for a.
    const [reading] = seriesIn(view, "in_progress");
    expect(reading).toMatchObject({
      kind: "series",
      seriesId,
      title: "Invented Ember Cycle",
      score: null,
      scoreCount: null,
      progress: { read: 1, total: 3 },
    });
    expect(reading.books.map((r) => [r.entryId, r.position])).toEqual([[entry.twoPrint, "2"]]);

    const [finished] = seriesIn(view, "finished");
    expect(finished.progress).toEqual({ read: 1, total: 3 });
    // In series order; print before audio; the interlude shows its own label.
    expect(finished.books.map((r) => [r.entryId, r.version, r.position])).toEqual([
      [entry.onePrint, "print", "1"],
      [entry.oneAudio, "audio", "1"],
      [entry.interlude, "print", "2.5"],
    ]);

    // A not-started book is in the Books queue, never under its series.
    expect(view.upNext.book.map((r) => r.entryId)).toEqual([entry.audio, entry.print, entry.threeAudio]);
    expect(view.upNext.book.at(-1)).toMatchObject({ title: "Invented Ember Three", version: "audio" });
  });

  test("the user's own exclusions leave the count; a half position never was in it", async () => {
    const excluded = await a.client.from("book_exclusions").insert([{ item_id: item.three }, { item_id: item.interlude }]);
    expect(excluded.error).toBeNull();
    const view = await getMyLibrary(a.client, a.id);
    expect(seriesIn(view, "finished")[0].progress).toEqual({ read: 1, total: 2 });

    // Excluding the finished book 1 takes it out of both counts.
    expect((await a.client.from("book_exclusions").insert({ item_id: item.one })).error).toBeNull();
    expect(seriesIn(await getMyLibrary(a.client, a.id), "finished")[0].progress).toEqual({ read: 0, total: 1 });
    expect((await a.client.from("book_exclusions").delete().eq("item_id", item.one)).error).toBeNull();
  });

  test("removing the print entry keeps the audio one, and the book still counts once", async () => {
    await deleteEntry(a.client, a.id, entry.onePrint);

    const { data } = await adminClient().from("library_entries").select("id, book_version").eq("item_id", item.one).eq("user_id", a.id);
    expect(data).toEqual([{ id: entry.oneAudio, book_version: "audio" }]);

    const [finished] = seriesIn(await getMyLibrary(a.client, a.id), "finished");
    expect(finished.books.map((r) => r.entryId)).toEqual([entry.oneAudio, entry.interlude]);
    expect(finished.progress).toEqual({ read: 1, total: 2 });
  });

  test("a book with no series is a plain row in its status group", async () => {
    await setEntryStatus(a.client, a.id, entry.audio, "paused");
    const view = await getMyLibrary(a.client, a.id);
    const paused = view.groups.find((g) => g.status === "paused")!;
    expect(paused.rows).toEqual([
      expect.objectContaining({ kind: "item", entryId: entry.audio, version: "audio", mediaType: "book" }),
    ]);
    expect((paused.rows[0] as ItemRow).title).toBe("Invented Standalone Book");
  });
});
