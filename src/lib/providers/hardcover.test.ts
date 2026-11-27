// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getHardcoverDetails, resetHardcoverLimiterForTests, searchHardcover } from "./hardcover";
import { ProviderError } from "./types";
import search from "./__fixtures__/hardcover-search.json";
import book from "./__fixtures__/hardcover-book.json";
import bookOdd from "./__fixtures__/hardcover-book-odd.json";

vi.mock("server-only", () => ({}));

const URL_ = "http://hardcover.test/v1/graphql";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return json(body, status);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const sent = (fn: ReturnType<typeof vi.fn>, i = 0) => {
  const [url, init] = fn.mock.calls[i] as [string, RequestInit];
  return { url: String(url), init, body: JSON.parse(String(init.body)) as { query: string } };
};

/** Number of fields selected directly inside the outermost braces of a query. */
function topLevelFields(query: string): number {
  let depth = 0;
  let fields = 0;
  let inString = false;
  let prevWord = false;
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "(") depth++;
    else if (c === "}" || c === ")") depth--;
    const word = /[A-Za-z0-9_]/.test(c);
    if (depth === 1 && word && !prevWord && /[A-Za-z_]/.test(c)) fields++;
    prevWord = word;
  }
  return fields;
}

beforeEach(() => {
  resetHardcoverLimiterForTests();
  vi.stubEnv("HARDCOVER_API_URL", URL_);
  vi.stubEnv("HARDCOVER_API_TOKEN", "x");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("search maps books, image url, year and hasAudiobook, and never maps description", async () => {
  const fn = stub(search);
  const results = await searchHardcover("orchard");
  expect(results).toEqual([
    { provider: "hardcover", providerId: "9001", mediaType: "book", title: "The Glass Orchard", year: 2014, imageUrl: "https://assets.hardcover.app/edition/9001/cover-a.jpg", hasAudiobook: true },
    { provider: "hardcover", providerId: "9002", mediaType: "book", title: "Quiet Harbour", year: null, imageUrl: null, hasAudiobook: false },
  ]);
  expect(JSON.stringify(results)).not.toContain("DESCRIPTION");
  const { url, init, body } = sent(fn);
  expect(url).toBe(URL_);
  expect((init.headers as Record<string, string>)["User-Agent"]).toBe("upnext (https://github.com/LS901/upnext)");
  expect(body.query).toContain('query_type: "book"');
  expect(body.query).toContain("per_page: 10");
});

test("search escapes the query inside the GraphQL string", async () => {
  const fn = stub(search);
  await searchHardcover('a "b" \\ c');
  expect(sent(fn).body.query).toContain('query: "a \\"b\\" \\\\ c"');
});

test("details map pages, audio minutes, narrators, the featured series and the x20 score", async () => {
  const fn = stub(book);
  const d = await getHardcoverDetails("9001");
  expect(d).toEqual({
    provider: "hardcover",
    mediaType: "book",
    providerId: "9001",
    title: "The Glass Orchard",
    imageRef: "https://assets.hardcover.app/edition/9001/cover-a.jpg",
    releaseDate: "2014-06-01",
    runtimeMinutes: null,
    score: 84,
    scoreCount: 1234,
    timeToBeat: null,
    timeToBeatUnavailable: false,
    seasons: null,
    book: {
      pageCount: 320,
      audioMinutes: 971,
      hasAudiobook: true,
      narrators: ["Ben Voice", "Cora Voice"],
      series: { providerId: "800", name: "Orchard Cycle", primaryBooksCount: 6, isCompleted: true, position: 1, positionLabel: "1" },
    },
  });
  expect(sent(fn).body.query).not.toContain("description");
});

test("a book in two series with none featured uses the lowest series id", async () => {
  stub(bookOdd);
  const d = await getHardcoverDetails("9002");
  expect(d.book?.series).toEqual({ providerId: "500", name: "Tide Set", primaryBooksCount: null, isCompleted: null, position: 3, positionLabel: "3" });
});

test("a book with no pages, audio, rating or image maps to nulls", async () => {
  stub(bookOdd);
  const d = await getHardcoverDetails("9002");
  expect(d.score).toBeNull();
  expect(d.scoreCount).toBeNull();
  expect(d.imageRef).toBeNull();
  expect(d.releaseDate).toBeNull();
  expect(d.book).toMatchObject({ pageCount: null, audioMinutes: null, hasAudiobook: false, narrators: [] });
});

test("details reject a non-numeric id and a missing book", async () => {
  const fn = stub({ data: { books_by_pk: null } });
  await expect(getHardcoverDetails("1; drop")).rejects.toBeInstanceOf(ProviderError);
  expect(fn).not.toHaveBeenCalled();
  await expect(getHardcoverDetails("5")).rejects.toBeInstanceOf(ProviderError);
});

test.each([429, 503])("HTTP %i throws ProviderError carrying only the status", async (status) => {
  stub({ error: "SECRET BODY" }, status);
  const err = await searchHardcover("x").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err).toMatchObject({ provider: "hardcover", status });
  expect((err as Error).message).toBe(`hardcover request failed (${status})`);
});

test("a 200 with errors throws without echoing them", async () => {
  stub({ errors: [{ message: "query text secret" }] });
  const err = await searchHardcover("x").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect((err as Error).message).not.toContain("secret");
});

test("a network failure throws ProviderError", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("boom token");
  }));
  const err = await searchHardcover("x").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect((err as Error).message).not.toContain("token");
});

test.each(["x", "Bearer x", "bearer x"])("Authorization is Bearer x for the token %s", async (token) => {
  vi.stubEnv("HARDCOVER_API_TOKEN", token);
  const fn = stub(search);
  await searchHardcover("a");
  expect((sent(fn).init.headers as Record<string, string>).Authorization).toBe("Bearer x");
});

test("each request has exactly one top-level field", async () => {
  const s = stub(search);
  await searchHardcover("a");
  expect(topLevelFields(sent(s).body.query)).toBe(1);
  const d = stub(book);
  await getHardcoverDetails("9001");
  expect(topLevelFields(sent(d).body.query)).toBe(1);
});

test("the limiter starts requests at least 1000 ms apart", async () => {
  vi.useFakeTimers();
  const fn = stub(search);
  const a = searchHardcover("a");
  const b = searchHardcover("b");
  await vi.advanceTimersByTimeAsync(0);
  expect(fn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(999);
  expect(fn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fn).toHaveBeenCalledTimes(2);
  await Promise.all([a, b]);
});
