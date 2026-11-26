import { expect, test } from "vitest";
import { formatScore } from "./score";

test("a score with its vote count", () => {
  expect(formatScore(71, 321)).toBe("Score 71/100 (321 votes)");
  expect(formatScore(81.5, 44)).toBe("Score 82/100 (44 votes)");
  expect(formatScore(90, 1)).toBe("Score 90/100 (1 vote)");
});

test("no score is No score", () => {
  expect(formatScore(null, null)).toBe("No score");
  expect(formatScore(null, 12)).toBe("No score");
});

test("an unknown vote count is left out", () => {
  expect(formatScore(64, null)).toBe("Score 64/100");
});
