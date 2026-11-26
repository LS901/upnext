import { expect, test } from "vitest";
import { formatDuration } from "./duration";

test("unknown is unknown", () => {
  expect(formatDuration(null)).toBe("unknown");
});

test("hours and minutes", () => {
  expect(formatDuration(125)).toBe("2 h 5 min");
  expect(formatDuration(104)).toBe("1 h 44 min");
});

test("under an hour is minutes only, whole hours are hours only", () => {
  expect(formatDuration(45)).toBe("45 min");
  expect(formatDuration(0)).toBe("0 min");
  expect(formatDuration(720)).toBe("12 h");
});

test("fractional minutes round to the nearest minute", () => {
  // A game's time to beat is stored in seconds: 43,230 s is 720.5 min.
  expect(formatDuration(720.5)).toBe("12 h 1 min");
  expect(formatDuration(59.6)).toBe("1 h");
});
