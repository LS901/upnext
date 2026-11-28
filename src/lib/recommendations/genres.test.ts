import { expect, test } from "vitest";
import { MAX_ROWS, pickRows, rowsFor, rowTitle, type GenreEntry } from "./genres";

const e = (mediaType: GenreEntry["mediaType"], genres: string[], status: GenreEntry["status"] = "backlog"): GenreEntry => ({
  mediaType,
  genres,
  status,
});

test("each type gives its top 2 genres by entry count", () => {
  const rows = pickRows(
    [
      e("movie", ["Horror", "Thriller"]),
      e("movie", ["Horror", "Comedy"]),
      e("movie", ["Horror", "Thriller"]),
      e("movie", ["Drama"]),
      e("game", ["Puzzle"]),
    ],
    [],
  );
  expect(rows).toEqual([
    { mediaType: "movie", genre: "Horror" },
    { mediaType: "game", genre: "Puzzle" },
    { mediaType: "movie", genre: "Thriller" },
  ]);
});

test("pins come first, in pin order, then the library's genres", () => {
  const rows = pickRows(
    [e("movie", ["Horror"]), e("book", ["Fantasy"])],
    [
      { mediaType: "show", genre: "Comedy" },
      { mediaType: "game", genre: "Puzzle" },
    ],
  );
  expect(rows).toEqual([
    { mediaType: "show", genre: "Comedy" },
    { mediaType: "game", genre: "Puzzle" },
    { mediaType: "movie", genre: "Horror" },
    { mediaType: "book", genre: "Fantasy" },
  ]);
});

test("Dropped entries don't count, and neither does Other", () => {
  const rows = pickRows(
    [
      e("movie", ["Horror"], "dropped"),
      e("movie", ["Horror"], "dropped"),
      e("movie", ["Comedy"], "finished"),
      e("other", ["Horror"]),
    ],
    [],
  );
  expect(rows).toEqual([{ mediaType: "movie", genre: "Comedy" }]);
});

test("ties are broken by genre name", () => {
  const rows = pickRows([e("movie", ["Western", "Animation", "Mystery"])], []);
  expect(rows).toEqual([
    { mediaType: "movie", genre: "Animation" },
    { mediaType: "movie", genre: "Mystery" },
  ]);
});

test("no duplicates: a pinned genre isn't repeated, nor a pin given twice", () => {
  const rows = pickRows(
    [e("movie", ["Horror", "Comedy"]), e("movie", ["Horror"])],
    [
      { mediaType: "movie", genre: "Horror" },
      { mediaType: "movie", genre: "Horror" },
    ],
  );
  expect(rows).toEqual([
    { mediaType: "movie", genre: "Horror" },
    { mediaType: "movie", genre: "Comedy" },
  ]);
});

test("the same genre in two types is two rows", () => {
  const rows = pickRows([e("movie", ["Comedy"]), e("show", ["Comedy"])], []);
  expect(rows).toEqual([
    { mediaType: "movie", genre: "Comedy" },
    { mediaType: "show", genre: "Comedy" },
  ]);
});

test("at most 6 rows, pins included", () => {
  const library = [
    e("movie", ["Horror", "Comedy"]),
    e("show", ["Drama", "Crime"]),
    e("game", ["Puzzle", "Strategy"]),
    e("book", ["Fantasy", "Mystery"]),
  ];
  expect(pickRows(library, [])).toHaveLength(MAX_ROWS);
  expect(MAX_ROWS).toBe(6);

  const pins = ["A", "B", "C", "D", "E", "F", "G"].map((genre) => ({ mediaType: "movie" as const, genre }));
  const rows = pickRows(library, pins);
  expect(rows).toEqual(pins.slice(0, 6));
});

test("nothing in, nothing out", () => {
  expect(pickRows([], [])).toEqual([]);
  expect(pickRows([e("movie", [])], [])).toEqual([]);
});

test("row titles", () => {
  expect(rowTitle("movie", "Horror")).toBe("Horror films you might like");
  expect(rowTitle("show", "Comedy")).toBe("Comedy TV you might like");
  expect(rowTitle("game", "Puzzle")).toBe("Puzzle games you might like");
  expect(rowTitle("book", "Fantasy")).toBe("Fantasy books you might like");
});

test("rowsFor: hidden types get no rows, and a book pin counts only while it is one of the library's book genres", () => {
  const library = [e("movie", ["Horror"]), e("book", ["Fantasy"]), e("game", ["Puzzle"])];
  const pins = [
    { mediaType: "book" as const, genre: "my secret words" },
    { mediaType: "book" as const, genre: "Fantasy" },
    { mediaType: "game" as const, genre: "Strategy" },
  ];
  expect(rowsFor(library, pins, [])).toEqual([
    { mediaType: "book", genre: "Fantasy" },
    { mediaType: "game", genre: "Strategy" },
    { mediaType: "movie", genre: "Horror" },
    { mediaType: "game", genre: "Puzzle" },
  ]);
  expect(rowsFor(library, pins, ["game", "book"])).toEqual([{ mediaType: "movie", genre: "Horror" }]);
});
