import { expect, test } from "vitest";
import { showProgress } from "./progress";

const seasons = [
  { id: "s0", number: 0 },
  { id: "s1", number: 1 },
  { id: "s2", number: 2 },
  { id: "s3", number: 3 },
];

test("counts the show's seasons and the finished ones", () => {
  expect(showProgress(seasons, new Set(), new Set())).toEqual({ finished: 0, total: 3 });
  expect(showProgress(seasons, new Set(["s1", "s3"]), new Set())).toEqual({ finished: 2, total: 3 });
});

test("specials (season 0) count in neither total", () => {
  expect(showProgress(seasons, new Set(["s0"]), new Set())).toEqual({ finished: 0, total: 3 });
  expect(showProgress([{ id: "s0", number: 0 }], new Set(["s0"]), new Set())).toEqual({ finished: 0, total: 0 });
});

test("excluded seasons are removed from both counts", () => {
  expect(showProgress(seasons, new Set(["s1", "s2"]), new Set(["s2"]))).toEqual({ finished: 1, total: 2 });
  // Excluding a season the user never finished (or never added) only shrinks the total.
  expect(showProgress(seasons, new Set(["s1"]), new Set(["s3"]))).toEqual({ finished: 1, total: 2 });
});

test("a show with no seasons is 0 of 0", () => {
  expect(showProgress([], new Set(), new Set())).toEqual({ finished: 0, total: 0 });
  // Finished or excluded ids that aren't the show's seasons are ignored.
  expect(showProgress([], new Set(["other"]), new Set(["other"]))).toEqual({ finished: 0, total: 0 });
});
