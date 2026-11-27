import { expect, test } from "vitest";
import { bookMeta, formatPages } from "./book";

const print = { version: "print" as const, pages: 320, minutes: null, narrators: null, score: 84, scoreCount: 1234, providerName: "hardcover" as const };
const audio = { version: "audio" as const, pages: null, minutes: 680, narrators: "Invented Reader, Other Voice", score: 84, scoreCount: 1234, providerName: "hardcover" as const };

test("pages read in the plural, except for one", () => {
  expect(formatPages(320)).toBe("320 pages");
  expect(formatPages(1)).toBe("1 page");
  expect(formatPages(1200)).toBe("1,200 pages");
});

test("a print book: type, pages and the Hardcover rating", () => {
  expect(bookMeta(print)).toBe("Book · 320 pages · Hardcover rating 4.2/5 (1,234)");
  expect(bookMeta({ ...print, pages: 1, scoreCount: null })).toBe("Book · 1 page · Hardcover rating 4.2/5");
  // No page count: no pages, never "0 pages".
  expect(bookMeta({ ...print, pages: null, score: null, scoreCount: null })).toBe("Book · No score");
});

test("an audiobook: the version, its length and the narrators", () => {
  expect(bookMeta(audio)).toBe("Audiobook · 11 h 20 min · Narrated by Invented Reader, Other Voice");
  expect(bookMeta({ ...audio, minutes: null, narrators: null })).toBe("Audiobook");
});
