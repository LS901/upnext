import { describe, expect, test } from "vitest";
import { playAgainLabel, playCountLine } from "./plays";

describe("playAgainLabel", () => {
  test.each([
    ["movie", null, "Watched again"],
    ["show", null, "Watched again"],
    ["game", null, "Played again"],
    ["book", "print", "Read again"],
    ["book", "audio", "Listened again"],
    ["other", null, "Done again"],
  ] as const)("%s (%s) is %s", (type, version, label) => {
    expect(playAgainLabel(type, version)).toBe(label);
  });
});

describe("playCountLine", () => {
  test("is null until there is an extra play", () => {
    expect(playCountLine("movie", null, 0)).toBeNull();
  });
  test.each([
    ["movie", null, 1, "Watched 2 times"],
    ["show", null, 3, "Watched 4 times"],
    ["game", null, 1, "Played 2 times"],
    ["book", "print", 1, "Read 2 times"],
    ["book", "audio", 2, "Listened 3 times"],
    ["other", null, 1, "Done 2 times"],
  ] as const)("%s (%s) with %i is %s", (type, version, count, line) => {
    expect(playCountLine(type, version, count)).toBe(line);
  });
});
