// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getTmdbDetails, searchTmdb, tmdbImageUrl } from "./tmdb";
import { ProviderError } from "./types";
import search from "./__fixtures__/tmdb-search.json";
import movie from "./__fixtures__/tmdb-movie.json";
import movieOdd from "./__fixtures__/tmdb-movie-odd.json";
import tv from "./__fixtures__/tmdb-tv.json";
import season0 from "./__fixtures__/tmdb-season-0.json";
import season1 from "./__fixtures__/tmdb-season-1.json";
import season2 from "./__fixtures__/tmdb-season-2.json";

vi.mock("server-only", () => ({}));

const BASE = "http://tmdb.test/3";
const TOKEN = "test-token";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = new URL(String(input));
    const body = routes[url.pathname.replace("/3", "")];
    return body === undefined ? json({}, 404) : json(body);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const SHOW_ROUTES = {
  "/tv/9002": tv,
  "/tv/9002/season/0": season0,
  "/tv/9002/season/1": season1,
  "/tv/9002/season/2": season2,
};

beforeEach(() => {
  vi.stubEnv("TMDB_API_BASE_URL", BASE);
  vi.stubEnv("TMDB_API_READ_ACCESS_TOKEN", TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("multi-search keeps movies and TV, drops people, takes year from the date", async () => {
  stubFetch({ "/search/multi": search });
  const results = await searchTmdb("lantern");
  expect(results).toEqual([
    { provider: "tmdb", providerId: "9001", mediaType: "movie", title: "The Lantern Orchard", year: 2019, imageUrl: "https://image.tmdb.org/t/p/w342/lantern.jpg" },
    { provider: "tmdb", providerId: "9002", mediaType: "show", title: "Harbour of Echoes", year: 2021, imageUrl: null },
    { provider: "tmdb", providerId: "9004", mediaType: "movie", title: "Undated Tale", year: null, imageUrl: null },
  ]);
});

test("search sends the query and excludes adult results", async () => {
  const fn = stubFetch({ "/search/multi": search });
  await searchTmdb("the lantern");
  const url = new URL(String(fn.mock.calls[0][0]));
  expect(url.searchParams.get("query")).toBe("the lantern");
  expect(url.searchParams.get("include_adult")).toBe("false");
});

test("movie details normalise score to 0-100 and a missing runtime to null", async () => {
  stubFetch({ "/movie/9001": movie });
  const d = await getTmdbDetails("movie", "9001");
  expect(d).toEqual({
    provider: "tmdb",
    mediaType: "movie",
    providerId: "9001",
    title: "The Lantern Orchard",
    imageRef: "/lantern.jpg",
    releaseDate: "2019-06-14",
    runtimeMinutes: null,
    score: 72.5,
    scoreCount: 1234,
    timeToBeat: null,
    timeToBeatUnavailable: false,
    seasons: null,
  });
});

test("out-of-range scores, zero runtime and empty dates become null", async () => {
  stubFetch({ "/movie/9005": movieOdd });
  const d = await getTmdbDetails("movie", "9005");
  expect(d.score).toBeNull();
  expect(d.runtimeMinutes).toBeNull();
  expect(d.releaseDate).toBeNull();
  expect(d.imageRef).toBeNull();
});

test("a non-finite score becomes null", async () => {
  stubFetch({ "/movie/1": { id: 1, title: "X", vote_average: "abc", vote_count: 3 } });
  expect((await getTmdbDetails("movie", "1")).score).toBeNull();
});

test("show details sum episode runtimes per season; specials are number 0", async () => {
  stubFetch(SHOW_ROUTES);
  const d = await getTmdbDetails("show", "9002");
  expect(d.mediaType).toBe("show");
  expect(d.releaseDate).toBe("2021-03-02");
  expect(d.score).toBe(81);
  expect(d.seasons).toEqual([
    { number: 0, title: "Specials", episodeCount: 2, runtimeMinutes: 20, airDate: null, runtimeUnavailable: false },
    { number: 1, title: "Season 1", episodeCount: 3, runtimeMinutes: 92, airDate: "2021-03-02", runtimeUnavailable: false },
    { number: 2, title: "Season 2", episodeCount: 2, runtimeMinutes: null, airDate: "2022-04-05", runtimeUnavailable: false },
  ]);
});

test("a failed season request degrades that season instead of failing the show", async () => {
  const { "/tv/9002/season/2": _dropped, ...routes } = SHOW_ROUTES;
  void _dropped;
  stubFetch(routes); // season 2 now 404s
  const d = await getTmdbDetails("show", "9002");
  expect(d.seasons?.[1]).toMatchObject({ number: 1, runtimeMinutes: 92, runtimeUnavailable: false });
  expect(d.seasons?.[2]).toEqual({
    number: 2,
    title: "Season 2",
    episodeCount: 2,
    runtimeMinutes: null,
    airDate: "2022-04-05",
    runtimeUnavailable: true,
  });
});

test("a 429 or 500 on a season request also degrades, with no throw", async () => {
  for (const status of [429, 500]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname.replace("/3", "");
        if (path === "/tv/9002") return json(tv);
        return json({}, status);
      }),
    );
    const d = await getTmdbDetails("show", "9002");
    expect(d.seasons?.map((s) => s.runtimeUnavailable)).toEqual([true, true, true]);
    expect(d.seasons?.map((s) => s.runtimeMinutes)).toEqual([null, null, null]);
  }
});

test("a failed main show request still throws", async () => {
  const { "/tv/9002": _main, ...routes } = SHOW_ROUTES;
  void _main;
  stubFetch(routes);
  await expect(getTmdbDetails("show", "9002")).rejects.toMatchObject({ provider: "tmdb", status: 404 });
});

test("at most 5 season requests are in flight at once", async () => {
  const seasons = Array.from({ length: 12 }, (_, n) => ({ season_number: n, name: `Season ${n}`, episode_count: 1 }));
  let inFlight = 0;
  let peak = 0;
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname.replace("/3", "");
    if (path === "/tv/9100") return json({ id: 9100, name: "Many Seasons", seasons });
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return json({ episodes: [{ runtime: 30 }] });
  });
  vi.stubGlobal("fetch", fn);
  const d = await getTmdbDetails("show", "9100");
  expect(fn).toHaveBeenCalledTimes(13);
  expect(peak).toBe(5);
  expect(d.seasons?.map((s) => s.number)).toEqual(seasons.map((s) => s.season_number));
  expect(d.seasons?.every((s) => s.runtimeMinutes === 30)).toBe(true);
});

test("no season overview or episode title reaches the result", async () => {
  stubFetch(SHOW_ROUTES);
  expect(JSON.stringify(await getTmdbDetails("show", "9002"))).not.toContain("SECRET");
});

test("a 429 throws ProviderError with status 429", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({}, 429)));
  const err = await searchTmdb("x").catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err).toMatchObject({ provider: "tmdb", status: 429 });
});

test("a network failure throws ProviderError with null status", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
  const err = await searchTmdb("x").catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err.status).toBeNull();
});

test("every request goes to TMDB_API_BASE_URL with the Bearer header", async () => {
  const fn = stubFetch({ "/search/multi": search, ...SHOW_ROUTES });
  await searchTmdb("x");
  await getTmdbDetails("show", "9002");
  expect(fn).toHaveBeenCalledTimes(5);
  for (const [input, init] of fn.mock.calls) {
    expect(String(input).startsWith(BASE + "/")).toBe(true);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  }
});

test("tmdbImageUrl builds the URL, with a size, or null", () => {
  expect(tmdbImageUrl("/a.jpg")).toBe("https://image.tmdb.org/t/p/w342/a.jpg");
  expect(tmdbImageUrl("/a.jpg", "w92")).toBe("https://image.tmdb.org/t/p/w92/a.jpg");
  expect(tmdbImageUrl(null)).toBeNull();
});
