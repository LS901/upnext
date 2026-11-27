import { expect, test } from "vitest";
import { seriesProgress } from "./series-progress";

const book = (itemId: string, position: number | null, finished = false, excluded = false) => ({
  itemId,
  position,
  finished,
  excluded,
});

test("total is the series' primary count; read counts the finished main-line books", () => {
  expect(seriesProgress(5, [])).toEqual({ read: 0, total: 5 });
  expect(seriesProgress(5, [book("b1", 1, true), book("b2", 2), book("b3", 3, true)])).toEqual({ read: 2, total: 5 });
});

test("half positions and unpositioned books never count", () => {
  // A novella at 2.5 is outside Hardcover's primary count, so it's not read and not excluded from it.
  expect(seriesProgress(3, [book("b1", 1, true), book("b25", 2.5, true), book("bx", null, true)])).toEqual({
    read: 1,
    total: 3,
  });
  expect(seriesProgress(3, [book("b25", 2.5, false, true)])).toEqual({ read: 0, total: 3 });
});

test("excluded books leave both counts, even when finished", () => {
  expect(seriesProgress(4, [book("b1", 1, true, true), book("b2", 2, true), book("b3", 3, false, true)])).toEqual({
    read: 1,
    total: 2,
  });
});

test("print and audio of one book count once, finished or excluded", () => {
  // Both versions Finished: one book read (Review Focus 5).
  expect(seriesProgress(3, [book("b1", 1, true), book("b1", 1, true)])).toEqual({ read: 1, total: 3 });
  // Either version Finished is enough.
  expect(seriesProgress(3, [book("b1", 1, false), book("b1", 1, true)])).toEqual({ read: 1, total: 3 });
  // An excluded book's entries all leave the counts, and it's subtracted once.
  expect(seriesProgress(3, [book("b1", 1, true, true), book("b1", 1, true), book("b1", 1, false, true)])).toEqual({
    read: 0,
    total: 2,
  });
});

test("an unknown primary count is 0, never below", () => {
  expect(seriesProgress(null, [book("b1", 1, true)])).toEqual({ read: 1, total: 0 });
  expect(seriesProgress(null, [book("b1", 1, false, true)])).toEqual({ read: 0, total: 0 });
  expect(seriesProgress(1, [book("b1", 1, false, true), book("b2", 2, false, true)])).toEqual({ read: 0, total: 0 });
});
