import { expect, test } from "vitest";
import { MAX_QUERY_LENGTH, parseSearch, searchHref } from "./params";

test("a blank or whitespace-only query is empty", () => {
  expect(parseSearch({}).q).toBe("");
  expect(parseSearch({ q: "   \t " }).q).toBe("");
});

test("the query is trimmed, stripped of control characters and capped", () => {
  expect(parseSearch({ q: "  Harbour\u0000of\nGlass  " }).q).toBe("Harbour of Glass");
  expect(parseSearch({ q: "x".repeat(500) }).q).toHaveLength(MAX_QUERY_LENGTH);
  expect(parseSearch({ q: ["first", "second"] }).q).toBe("first");
});

test("exclude keeps known media types only, once each, in a fixed order", () => {
  expect(parseSearch({ exclude: ["game", "bogus", "movie", "game"] }).exclude).toEqual(["movie", "game"]);
  expect(parseSearch({ exclude: "show" }).exclude).toEqual(["show"]);
  expect(parseSearch({ exclude: undefined }).exclude).toEqual([]);
});

test("searchHref builds the search page URL", () => {
  expect(searchHref({ q: "", exclude: [] })).toBe("/search");
  expect(searchHref({ q: "Harbour & co", exclude: ["movie", "game"] }, { added: "1" })).toBe(
    "/search?q=Harbour+%26+co&exclude=movie&exclude=game&added=1",
  );
});
