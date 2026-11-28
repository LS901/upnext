import { describe, expect, test } from "vitest";
import type { ItemRow, LibraryView, QueuedSeasonRow, SeasonRow, SeriesRow, ShowRow } from "./queries";
import { filterView, parseTabType, tabCounts } from "./type-filter";

const item = (mediaType: ItemRow["mediaType"], entryId: string): ItemRow => ({
  kind: "item",
  entryId,
  status: "finished",
  playCount: 2,
  mediaType,
  version: mediaType === "book" ? "print" : null,
  title: `Title ${entryId}`,
  imageUrl: null,
  minutes: null,
  pages: null,
  narrators: null,
  lengthNote: null,
  providerName: "tmdb",
  score: null,
  scoreCount: null,
});
const season = (entryId: string): SeasonRow => ({
  entryId,
  status: "finished",
  playCount: 1,
  number: 1,
  episodeCount: 8,
  airDate: null,
  runtimeMinutes: null,
});
const show = (seasons: SeasonRow[]): ShowRow => ({
  kind: "show",
  showId: "s1",
  title: "A show",
  imageUrl: null,
  progress: { finished: 1, total: 3 },
  seasons,
  allSeasons: [{ seasonId: "x", number: 1, label: "Season 1", excluded: false }],
  score: null,
  scoreCount: null,
});
const series = (books: SeriesRow["books"]): SeriesRow => ({
  kind: "series",
  seriesId: "r1",
  title: "A series",
  progress: { read: 1, total: 2 },
  books,
  allBooks: [{ itemId: "b", label: "One", excluded: false }],
  score: null,
  scoreCount: null,
});
const queuedSeason = (entryId: string): QueuedSeasonRow => ({
  ...season(entryId),
  kind: "season",
  status: "backlog",
  showTitle: "A show",
  imageUrl: null,
  score: null,
  scoreCount: null,
});

const view: LibraryView = {
  upNext: {
    movie: [{ ...item("movie", "m1"), status: "backlog" }],
    show: [queuedSeason("q1")],
    game: [],
    book: [],
    other: [{ ...item("other", "o1"), status: "backlog" }],
  },
  groups: [
    {
      status: "finished",
      label: "Finished",
      rows: [
        item("movie", "m2"),
        item("game", "g1"),
        show([season("t1"), season("t2")]),
        series([{ ...item("book", "b1"), position: "1" }, { ...item("book", "b2"), position: "2" }]),
      ],
    },
    { status: "paused", label: "Paused", rows: [item("game", "g2")] },
  ],
};

describe("parseTabType", () => {
  test("accepts the six tabs", () => {
    for (const t of ["all", "movie", "show", "game", "book", "other"]) expect(parseTabType(t)).toBe(t);
  });
  test("anything else is All", () => {
    expect(parseTabType(undefined)).toBe("all");
    expect(parseTabType("")).toBe("all");
    expect(parseTabType("nope")).toBe("all");
    expect(parseTabType("MOVIE")).toBe("all");
    expect(parseTabType("__proto__")).toBe("all");
  });
  test("an array takes its first value", () => {
    expect(parseTabType(["game", "movie"])).toBe("game");
    expect(parseTabType(["nope", "game"])).toBe("all");
    expect(parseTabType([])).toBe("all");
  });
});

describe("filterView", () => {
  test("All is the view itself", () => {
    expect(filterView(view, "all")).toEqual(view);
  });
  test("a type keeps only its rows, in groups and queues, and drops emptied groups", () => {
    const games = filterView(view, "game");
    expect(games.upNext.movie).toEqual([]);
    expect(games.upNext.other).toEqual([]);
    expect(games.groups.map((g) => g.status)).toEqual(["finished", "paused"]);
    expect(games.groups.flatMap((g) => g.rows).map((r) => (r.kind === "item" ? r.entryId : r.kind))).toEqual(["g1", "g2"]);
    expect(filterView(view, "other").groups).toEqual([]);
  });
  test("show rows and queued seasons are TV; series rows are books", () => {
    const tv = filterView(view, "show");
    expect(tv.upNext.show).toHaveLength(1);
    expect(tv.groups).toHaveLength(1);
    expect(tv.groups[0].rows.map((r) => r.kind)).toEqual(["show"]);
    expect(filterView(view, "book").groups[0].rows.map((r) => r.kind)).toEqual(["series"]);
  });
  test("rows pass through untouched (play counts, allSeasons, allBooks)", () => {
    const tv = filterView(view, "show").groups[0].rows[0] as ShowRow;
    expect(tv).toBe(view.groups[0].rows[2]);
    expect(tv.allSeasons).toHaveLength(1);
    const books = filterView(view, "book").groups[0].rows[0] as SeriesRow;
    expect(books.allBooks).toHaveLength(1);
    expect(books.books[0].playCount).toBe(2);
  });
});

describe("tabCounts", () => {
  test("counts library entries per type, each season and book once, and All is the total", () => {
    expect(tabCounts(view)).toEqual({ all: 10, movie: 2, show: 3, game: 2, book: 2, other: 1 });
  });
  test("an empty library is all zeros", () => {
    const empty: LibraryView = { upNext: { movie: [], show: [], game: [], book: [], other: [] }, groups: [] };
    expect(tabCounts(empty)).toEqual({ all: 0, movie: 0, show: 0, game: 0, book: 0, other: 0 });
  });
});
