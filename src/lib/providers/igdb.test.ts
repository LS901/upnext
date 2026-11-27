// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getIgdbDetails, igdbImageUrl, resetIgdbTokenForTests, searchIgdb } from "./igdb";
import { ProviderError } from "./types";
import search from "./__fixtures__/igdb-search.json";
import game from "./__fixtures__/igdb-game.json";
import gameOdd from "./__fixtures__/igdb-game-odd.json";
import ttb from "./__fixtures__/igdb-time-to-beat.json";

vi.mock("server-only", () => ({}));

const BASE = "http://igdb.test/v4";
const TOKEN_URL = "http://twitch.test/oauth2/token";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(routes: Record<string, unknown>, expiresIn = 3600) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = new URL(String(input));
    if (url.href.startsWith(TOKEN_URL)) {
      return json({ access_token: "tok", expires_in: expiresIn, token_type: "bearer" });
    }
    const body = routes[url.pathname.replace("/v4", "")];
    return body === undefined ? json({}, 404) : json(body);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

type Fn = ReturnType<typeof vi.fn>;
const igdbCalls = (fn: Fn) => fn.mock.calls.filter((c) => !String(c[0]).startsWith(TOKEN_URL));
const tokenCalls = (fn: Fn) => fn.mock.calls.filter((c) => String(c[0]).startsWith(TOKEN_URL));

beforeEach(() => {
  resetIgdbTokenForTests();
  vi.stubEnv("IGDB_API_BASE_URL", BASE);
  vi.stubEnv("TWITCH_TOKEN_URL", TOKEN_URL);
  vi.stubEnv("IGDB_CLIENT_ID", "cid");
  vi.stubEnv("IGDB_CLIENT_SECRET", "csecret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("search maps games, cover to imageUrl and release date to year", async () => {
  const fn = stubFetch({ "/games": search });
  const results = await searchIgdb("lantern");
  expect(results).toEqual([
    { provider: "igdb", providerId: "5001", mediaType: "game", title: "Lantern Keep", year: 2020, imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg" },
    { provider: "igdb", providerId: "5002", mediaType: "game", title: "Undated Game", year: null, imageUrl: null },
  ]);
  const [url, init] = igdbCalls(fn)[0];
  expect(String(url)).toBe(`${BASE}/games`);
  const headers = (init as RequestInit).headers as Record<string, string>;
  expect(headers["Client-ID"]).toBe("cid");
  expect(headers.Authorization).toBe("Bearer tok");
});

test("quotes, semicolons and backslashes in the query are escaped inside the literal", async () => {
  const fn = stubFetch({ "/games": [] });
  await searchIgdb('portal"; fields *;');
  expect(String(igdbCalls(fn)[0][1]?.body)).toBe(
    'search "portal\\"; fields *;"; fields name,first_release_date,cover.image_id; limit 10;',
  );
  await searchIgdb('a\\"b');
  expect(String(igdbCalls(fn)[1][1]?.body)).toContain('search "a\\\\\\"b";');
});

test("details normalise the score and attach time to beat", async () => {
  const fn = stubFetch({ "/games": game, "/game_time_to_beats": ttb });
  const d = await getIgdbDetails("5001");
  expect(d).toEqual({
    provider: "igdb",
    mediaType: "game",
    providerId: "5001",
    title: "Lantern Keep",
    imageRef: "co1abc",
    releaseDate: "2020-01-01",
    runtimeMinutes: null,
    score: 81.46,
    scoreCount: 120,
    timeToBeat: { hastilyS: 36000, normallyS: 54000, completelyS: null, count: 42 },
    timeToBeatUnavailable: false,
    seasons: null,
    book: null,
  });
  const bodies = igdbCalls(fn).map((c) => String(c[1]?.body));
  expect(bodies.some((b) => b.includes("where game_id = 5001;"))).toBe(true);
});

test("no time-to-beat row gives null; out-of-range score and missing fields give null", async () => {
  stubFetch({ "/games": gameOdd, "/game_time_to_beats": [] });
  const d = await getIgdbDetails("5002");
  expect(d.timeToBeat).toBeNull();
  expect(d.timeToBeatUnavailable).toBe(false);
  expect(d.score).toBeNull();
  expect(d.imageRef).toBeNull();
  expect(d.releaseDate).toBeNull();
});

test("a time-to-beat row with no known values collapses to null", async () => {
  stubFetch({
    "/games": game,
    "/game_time_to_beats": [{ id: 2, game_id: 5001, hastily: 0, normally: null, count: 0 }],
  });
  const d = await getIgdbDetails("5001");
  expect(d.timeToBeat).toBeNull();
  expect(d.timeToBeatUnavailable).toBe(false);
});

test("a failed time-to-beat request still returns the details", async () => {
  for (const status of [429, 500]) {
    resetIgdbTokenForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.href.startsWith(TOKEN_URL)) return json({ access_token: "tok", expires_in: 3600 });
        return url.pathname.endsWith("/games") ? json(game) : json({}, status);
      }),
    );
    const d = await getIgdbDetails("5001");
    expect(d.title).toBe("Lantern Keep");
    expect(d.score).toBe(81.46);
    expect(d.timeToBeat).toBeNull();
    expect(d.timeToBeatUnavailable).toBe(true);
  }
});

test("a failed games request still throws", async () => {
  stubFetch({ "/game_time_to_beats": ttb });
  await expect(getIgdbDetails("5001")).rejects.toMatchObject({ provider: "igdb", status: 404 });
});

test("a non-numeric id is rejected before any request", async () => {
  const fn = stubFetch({});
  await expect(getIgdbDetails("1; fields *")).rejects.toBeInstanceOf(ProviderError);
  expect(fn).not.toHaveBeenCalled();
});

test("the token request sends the client credentials as a form body, never in the URL", async () => {
  const fn = stubFetch({ "/games": [] });
  await searchIgdb("a");
  const [input, init] = tokenCalls(fn)[0] as [RequestInfo | URL, RequestInit];
  const url = new URL(String(input));
  expect(url.href).toBe(TOKEN_URL);
  expect(url.search).toBe("");
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
  expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
    client_id: "cid",
    client_secret: "csecret",
    grant_type: "client_credentials",
  });
});

test("the token is fetched once for two calls and refetched after expiry", async () => {
  vi.useFakeTimers();
  const fn = stubFetch({ "/games": [] }, 600);
  await searchIgdb("a");
  await searchIgdb("b");
  expect(tokenCalls(fn)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(539_000); // before the 60 s margin
  await searchIgdb("c");
  expect(tokenCalls(fn)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2_000); // past expires_in minus 60 s
  await searchIgdb("d");
  expect(tokenCalls(fn)).toHaveLength(2);
});

test("a 401 refetches the token once and retries", async () => {
  let n = 0;
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith(TOKEN_URL)) return json({ access_token: `tok${++n}`, expires_in: 3600 });
    return n === 1 ? json({}, 401) : json([]);
  });
  vi.stubGlobal("fetch", fn);
  await expect(searchIgdb("x")).resolves.toEqual([]);
  expect(tokenCalls(fn)).toHaveLength(2);
});

test("a persistent 401 is a ProviderError, not a loop", async () => {
  const fn = vi.fn(async (input: RequestInfo | URL) =>
    String(input).startsWith(TOKEN_URL) ? json({ access_token: "t", expires_in: 3600 }) : json({}, 401),
  );
  vi.stubGlobal("fetch", fn);
  await expect(searchIgdb("x")).rejects.toMatchObject({ provider: "igdb", status: 401 });
  expect(tokenCalls(fn)).toHaveLength(2);
});

test("429 is a ProviderError, not an empty result", async () => {
  const fn = vi.fn(async (input: RequestInfo | URL) =>
    String(input).startsWith(TOKEN_URL) ? json({ access_token: "t", expires_in: 3600 }) : json({}, 429),
  );
  vi.stubGlobal("fetch", fn);
  const err = await searchIgdb("x").catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err).toMatchObject({ provider: "igdb", status: 429 });
});

test("network failure is a ProviderError with null status", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
  await expect(searchIgdb("x")).rejects.toMatchObject({ provider: "igdb", status: null });
});

test("five calls in a burst start at most 4 within the first second", async () => {
  vi.useFakeTimers();
  const fn = stubFetch({ "/games": [] });
  const all = Promise.all([1, 2, 3, 4, 5].map((i) => searchIgdb(`q${i}`)));
  await vi.advanceTimersByTimeAsync(0);
  expect(igdbCalls(fn)).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(999);
  expect(igdbCalls(fn)).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(2);
  expect(igdbCalls(fn)).toHaveLength(5);
  await all;
});

test("image url template", () => {
  expect(igdbImageUrl("abc")).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg");
  expect(igdbImageUrl("abc", "thumb")).toBe("https://images.igdb.com/igdb/image/upload/t_thumb/abc.jpg");
  expect(igdbImageUrl(null)).toBeNull();
});
