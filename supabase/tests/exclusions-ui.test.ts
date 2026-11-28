// "Progress" on a show or series row: the save sets the user's exclusions to
// exactly the unticked seasons or books, through the lib functions the actions
// call, and progress (read back through getMyLibrary) follows.
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { setBookExclusions, setSeasonExclusions } from "../../src/lib/library/exclusions";
import { getMyLibrary, type SeriesRow, type ShowRow } from "../../src/lib/library/queries";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const invented = () => String(randomInt(10_000_000, 99_999_999));

describe("progress exclusions from the library", () => {
  let a: TestUser;
  let b: TestUser;
  let showId = "";
  let seriesId = "";
  const season: Record<number, string> = {};
  const book: Record<string, string> = {};
  const itemIds: string[] = [];

  const show = async (u: TestUser) => {
    const { groups } = await getMyLibrary(u.client, u.id);
    return groups.flatMap((g) => g.rows).find((r): r is ShowRow => r.kind === "show" && r.showId === showId)!;
  };
  const series = async (u: TestUser) => {
    const { groups } = await getMyLibrary(u.client, u.id);
    return groups.flatMap((g) => g.rows).find((r): r is SeriesRow => r.kind === "series" && r.seriesId === seriesId)!;
  };
  const seasonRows = async (u: TestUser) => {
    const { data, error } = await adminClient()
      .from("progress_exclusions")
      .select("season_id")
      .eq("user_id", u.id)
      .order("season_id");
    if (error) throw error;
    return data.map((r) => r.season_id);
  };
  const bookRows = async (u: TestUser) => {
    const { data, error } = await adminClient()
      .from("book_exclusions")
      .select("item_id")
      .eq("user_id", u.id)
      .order("item_id");
    if (error) throw error;
    return data.map((r) => r.item_id);
  };
  const sorted = (...ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    const admin = adminClient();
    const { data: shows, error } = await admin
      .from("items")
      .insert({ provider: "tmdb", media_type: "show", provider_id: invented(), title: "Invented Exclusion Show" })
      .select("id")
      .single();
    if (error) throw error;
    showId = shows.id;
    itemIds.push(showId);
    const { data: seasons, error: seasonsError } = await admin
      .from("seasons")
      .insert(
        [0, 1, 2, 3].map((n) => ({
          show_id: showId,
          season_number: n,
          title: `Season ${n}`,
          episode_count: 8,
          air_date: `202${n}-01-01`,
        })),
      )
      .select("id, season_number");
    if (seasonsError) throw seasonsError;
    for (const s of seasons) season[s.season_number] = s.id;

    const { data: ser, error: serError } = await admin
      .from("book_series")
      .insert({ provider: "hardcover", provider_id: invented(), name: "Invented Exclusion Cycle", primary_books_count: 3 })
      .select("id")
      .single();
    if (serError) throw serError;
    seriesId = ser.id;
    const inSeries = (title: string, position: number, label: string | null = null) => ({
      provider: "hardcover" as const,
      media_type: "book" as const,
      provider_id: invented(),
      title,
      series_id: seriesId,
      series_position: position,
      series_position_label: label,
    });
    const { data: books, error: booksError } = await admin
      .from("items")
      .insert([
        inSeries("Invented Exclusion One", 1),
        inSeries("Invented Exclusion Two", 2),
        inSeries("Invented Exclusion Interlude", 2.5, "2.5"),
        inSeries("Invented Exclusion Three", 3),
      ])
      .select("id, title");
    if (booksError) throw booksError;
    for (const x of books) {
      book[x.title.replace("Invented Exclusion ", "")] = x.id;
      itemIds.push(x.id);
    }

    a = await createTestUser("excl-a");
    b = await createTestUser("excl-b");
    // Private, so these users' exclusions never show up in other tests' unfiltered reads.
    const { error: privateError } = await admin.from("profiles").update({ library_private: true }).in("id", [a.id, b.id]);
    if (privateError) throw privateError;
    for (const u of [a, b]) {
      const { error: e1 } = await u.client.from("library_entries").insert({ season_id: season[1], status: "finished" });
      if (e1) throw e1;
      const { error: e2 } = await u.client
        .from("library_entries")
        .insert({ item_id: book.One, item_media_type: "book", book_version: "print", status: "finished" });
      if (e2) throw e2;
    }
  });

  afterAll(async () => {
    await deleteTestUsers([a, b].filter(Boolean));
    const admin = adminClient();
    if (itemIds.length) await admin.from("items").delete().in("id", itemIds);
    if (seriesId) await admin.from("book_series").delete().eq("id", seriesId);
  });

  test("a show lists its seasons (not specials), all counted at first", async () => {
    const row = await show(a);
    expect(row.progress).toEqual({ finished: 1, total: 3 });
    expect(row.allSeasons).toEqual([
      { seasonId: season[1], number: 1, label: "Season 1 · 8 episodes · 2021", excluded: false },
      { seasonId: season[2], number: 2, label: "Season 2 · 8 episodes · 2022", excluded: false },
      { seasonId: season[3], number: 3, label: "Season 3 · 8 episodes · 2023", excluded: false },
    ]);
  });

  test("unticking a season makes progress x of n-1; saving twice leaves the same rows", async () => {
    await setSeasonExclusions(a.client, a.id, showId, [season[1], season[2]]);
    expect((await show(a)).progress).toEqual({ finished: 1, total: 2 });
    expect((await show(a)).allSeasons.map((s) => s.excluded)).toEqual([false, false, true]);
    expect(await seasonRows(a)).toEqual([season[3]]);

    await setSeasonExclusions(a.client, a.id, showId, [season[1], season[2]]);
    expect(await seasonRows(a)).toEqual([season[3]]);

    // Changing the ticks swaps the rows; ticking everything clears them.
    await setSeasonExclusions(a.client, a.id, showId, [season[1], season[3]]);
    expect(await seasonRows(a)).toEqual([season[2]]);
    await setSeasonExclusions(a.client, a.id, showId, [season[1], season[2], season[3]]);
    expect(await seasonRows(a)).toEqual([]);
    expect((await show(a)).progress).toEqual({ finished: 1, total: 3 });
  });

  test("an id that isn't one of the show's seasons is ignored, and specials never take a row", async () => {
    // Only season 1 is "counted" here, so seasons 2 and 3 are excluded; the
    // stray id counts for nothing and specials (season 0) are never excluded.
    await setSeasonExclusions(a.client, a.id, showId, [season[1], "00000000-0000-4000-8000-000000000000"]);
    expect(await seasonRows(a)).toEqual(sorted(season[2], season[3]));
    await setSeasonExclusions(a.client, a.id, showId, [season[1], season[2], season[3]]);
    expect(await seasonRows(a)).toEqual([]);
  });

  test("a user can't write another user's season exclusions", async () => {
    await expect(setSeasonExclusions(a.client, b.id, showId, [season[1]])).rejects.toThrow();
    expect(await seasonRows(b)).toEqual([]);
    await setSeasonExclusions(b.client, b.id, showId, [season[1], season[2]]);
    // a's own saves leave b's rows alone, whichever way they go.
    await setSeasonExclusions(a.client, a.id, showId, []);
    expect(await seasonRows(b)).toEqual([season[3]]);
    await setSeasonExclusions(a.client, a.id, showId, [season[1], season[2], season[3]]);
    expect(await seasonRows(b)).toEqual([season[3]]);
    // Even naming b's id, a's client can't delete b's rows.
    await setSeasonExclusions(a.client, b.id, showId, [season[1], season[2], season[3]]).catch(() => {});
    expect(await seasonRows(b)).toEqual([season[3]]);
  });

  test("a series lists its main-line books, all counted at first", async () => {
    const row = await series(a);
    expect(row.progress).toEqual({ read: 1, total: 3 });
    expect(row.allBooks).toEqual([
      { itemId: book.One, label: "#1 Invented Exclusion One", excluded: false },
      { itemId: book.Two, label: "#2 Invented Exclusion Two", excluded: false },
      { itemId: book.Three, label: "#3 Invented Exclusion Three", excluded: false },
    ]);
  });

  test("unticking a book makes progress x of n-1; saving twice leaves the same rows", async () => {
    await setBookExclusions(a.client, a.id, seriesId, [book.One, book.Two]);
    expect((await series(a)).progress).toEqual({ read: 1, total: 2 });
    expect((await series(a)).allBooks.map((x) => x.excluded)).toEqual([false, false, true]);
    expect(await bookRows(a)).toEqual([book.Three]);

    await setBookExclusions(a.client, a.id, seriesId, [book.One, book.Two]);
    expect(await bookRows(a)).toEqual([book.Three]);

    await setBookExclusions(a.client, a.id, seriesId, [book.One, book.Two, book.Three]);
    expect(await bookRows(a)).toEqual([]);
  });

  test("a user can't write another user's book exclusions", async () => {
    await expect(setBookExclusions(a.client, b.id, seriesId, [book.One])).rejects.toThrow();
    expect(await bookRows(b)).toEqual([]);
    await setBookExclusions(b.client, b.id, seriesId, [book.One]);
    expect(await bookRows(b)).toEqual(sorted(book.Two, book.Three));
    await setBookExclusions(a.client, a.id, seriesId, [book.One, book.Two, book.Three]);
    expect(await bookRows(b)).toEqual(sorted(book.Two, book.Three));
  });
});
