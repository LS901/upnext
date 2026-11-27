import { describe, expect, test } from "vitest";
import { hiddenFromShown, parseHidden, placeBefore, queueOf, targetFor, type Placed } from "./up-next-order";

const q = (...pairs: [string, number][]): Placed[] => pairs.map(([id, position]) => ({ id, position }));

describe("which queues are hidden", () => {
  test("the cookie lists hidden types; anything else in it is ignored", () => {
    expect(parseHidden(undefined)).toEqual([]);
    expect(parseHidden("")).toEqual([]);
    expect(parseHidden("game,movie")).toEqual(["movie", "game"]);
    expect(parseHidden("game,book,<script>,game")).toEqual(["game"]);
  });

  test("the ticked boxes are what's shown; the rest is hidden", () => {
    expect(hiddenFromShown(["movie", "show", "game"])).toBe("");
    expect(hiddenFromShown(["show"])).toBe("movie,game");
    expect(hiddenFromShown(["show", "nonsense"])).toBe("movie,game");
    expect(hiddenFromShown([])).toBe("movie,show,game");
  });
});

describe("queueOf", () => {
  test("movies and games queue by their type; seasons queue as TV", () => {
    expect(queueOf({ item_media_type: "movie", season_id: null })).toBe("movie");
    expect(queueOf({ item_media_type: "game", season_id: null })).toBe("game");
    expect(queueOf({ item_media_type: null, season_id: "s-1" })).toBe("show");
  });

  test("an entry that is neither an item nor a season is refused, not filed as a movie", () => {
    expect(() => queueOf({ item_media_type: null, season_id: null })).toThrow("no queue");
  });
});

describe("placeBefore", () => {
  const abc = q(["a", 1], ["b", 2], ["c", 3]);

  test("moving to the end goes one past the last", () => {
    expect(placeBefore(abc, "a", null)).toEqual({ kind: "one", id: "a", position: 4 });
  });

  test("moving to the front goes one before the first", () => {
    expect(placeBefore(abc, "c", "a")).toEqual({ kind: "one", id: "c", position: 0 });
  });

  test("moving between two lands halfway, touching nothing else", () => {
    expect(placeBefore(abc, "a", "c")).toEqual({ kind: "one", id: "a", position: 2.5 });
  });

  test("a new entry (not yet queued) goes where asked; into an empty queue it gets 1", () => {
    expect(placeBefore(abc, "d", null)).toEqual({ kind: "one", id: "d", position: 4 });
    expect(placeBefore(abc, "d", "b")).toEqual({ kind: "one", id: "d", position: 1.5 });
    expect(placeBefore([], "d", null)).toEqual({ kind: "one", id: "d", position: 1 });
  });

  test("a move that leaves the order as it is changes nothing", () => {
    expect(placeBefore(abc, "b", "c")).toBeNull();
    expect(placeBefore(abc, "c", null)).toBeNull();
    expect(placeBefore(abc, "a", "a")).toBeNull();
  });

  test("when two neighbours are too close to split, the whole new order is returned to renumber", () => {
    const tight = q(["a", 1], ["b", 1 + 1e-12], ["c", 2]);
    expect(placeBefore(tight, "c", "b")).toEqual({ kind: "renumber", order: ["a", "c", "b"] });
    // Duplicate positions (two adds at once) have no gap at all.
    const tied = q(["a", 1], ["b", 1], ["c", 2]);
    expect(placeBefore(tied, "c", "b")).toEqual({ kind: "renumber", order: ["a", "c", "b"] });
  });

  test("a target that isn't in the queue is refused", () => {
    expect(() => placeBefore(abc, "a", "zzz")).toThrow("not in this queue");
  });
});

describe("targetFor", () => {
  const abc = ["a", "b", "c"];

  test("up goes before the one above; down goes before the one two below, or to the end", () => {
    expect(targetFor(abc, "b", "up")).toEqual({ beforeId: "a" });
    expect(targetFor(abc, "a", "down")).toEqual({ beforeId: "c" });
    expect(targetFor(abc, "b", "down")).toEqual({ beforeId: null });
  });

  test("top goes before the first", () => {
    expect(targetFor(abc, "c", "top")).toEqual({ beforeId: "a" });
  });

  test("moves past either end, or of an entry not queued, are no-ops", () => {
    expect(targetFor(abc, "a", "up")).toBeNull();
    expect(targetFor(abc, "a", "top")).toBeNull();
    expect(targetFor(abc, "c", "down")).toBeNull();
    expect(targetFor(abc, "zzz", "up")).toBeNull();
  });
});
