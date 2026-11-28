// @vitest-environment node
// Recommendations by genre: the provider queries, the 12 h cache, failure and
// INV-006 (a recommendation request carries a genre and nothing about the user).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resetHardcoverLimiterForTests } from "@/lib/providers/hardcover";
import { resetIgdbTokenForTests } from "@/lib/providers/igdb";
import genresMovie from "@/lib/providers/__fixtures__/tmdb-genres-movie.json";
import genresTv from "@/lib/providers/__fixtures__/tmdb-genres-tv.json";
import discoverMovie from "@/lib/providers/__fixtures__/tmdb-discover-movie.json";
import discoverTv from "@/lib/providers/__fixtures__/tmdb-discover-tv.json";
import igdbGenres from "@/lib/providers/__fixtures__/igdb-genres.json";
import igdbSearch from "@/lib/providers/__fixtures__/igdb-search.json";
import hardcoverSearch from "@/lib/providers/__fixtures__/hardcover-search.json";
import { genreOptions, suggestByGenre, SUGGESTION_LIMIT } from "./suggest";

vi.mock("server-only", () => ({}));
const cache = vi.hoisted(() => ({ cacheLife: vi.fn() }));
vi.mock("next/cache", () => cache);

const TMDB = "http://tmdb.test/3";
const IGDB = "http://igdb.test/v4";
const TWITCH = "http://twitch.test/oauth2/token";
const HARDCOVER = "http://hardcover.test/v1/graphql";

// Invented user data, planted where careless code could pick it up.
const USER_ID = "5d2b8e41-0c6f-4a7e-b3d9-recsuser0001";
const EMAIL = "fern.calder@example.test";

type Captured = { url: URL; body: string | null; headers: Headers };
let captured: Captured[] = [];
let failures: Record<string, number> = {};
let tmdbRoutes: Record<string, unknown> = {};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetIgdbTokenForTests();
  resetHardcoverLimiterForTests();
  captured = [];
  failures = {};
  tmdbRoutes = {
    "/genre/movie/list": genresMovie,
    "/genre/tv/list": genresTv,
    "/discover/movie": discoverMovie,
    "/discover/tv": discoverTv,
  };
  cache.cacheLife.mockReset();
  vi.stubEnv("TMDB_API_BASE_URL", TMDB);
  vi.stubEnv("IGDB_API_BASE_URL", IGDB);
  vi.stubEnv("TWITCH_TOKEN_URL", TWITCH);
  vi.stubEnv("HARDCOVER_API_URL", HARDCOVER);
  vi.stubEnv("TMDB_API_READ_ACCESS_TOKEN", "tmdb-token");
  vi.stubEnv("IGDB_CLIENT_ID", "igdb-cid");
  vi.stubEnv("IGDB_CLIENT_SECRET", "igdb-csecret");
  vi.stubEnv("HARDCOVER_API_TOKEN", "hc-token");
  vi.stubEnv("UPNEXT_TEST_USER_ID", USER_ID);
  vi.stubEnv("UPNEXT_TEST_USER_EMAIL", EMAIL);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body == null ? null : String(init.body);
      captured.push({ url, body, headers: new Headers(init?.headers) });
      if (url.href.startsWith(TWITCH)) return json({ access_token: "tok", expires_in: 3600 });
      if (url.href.startsWith(TMDB)) {
        const path = url.pathname.replace("/3", "");
        if (failures[path]) return json({}, failures[path]);
        const route = tmdbRoutes[path];
        return route === undefined ? json({}, 404) : json(route);
      }
      if (url.href.startsWith(IGDB)) {
        const path = url.pathname.replace("/v4", "");
        if (failures[path]) return json({}, failures[path]);
        return json(path === "/genres" ? igdbGenres : igdbSearch);
      }
      if (url.href.startsWith(HARDCOVER)) {
        if (failures.hardcover) return json({}, failures.hardcover);
        return json(hardcoverSearch);
      }
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const TWELVE_HOURS = 12 * 60 * 60;
const tmdbCalls = () => captured.filter((c) => c.url.href.startsWith(TMDB)).map((c) => c.url);
const igdbBodies = () => captured.filter((c) => c.url.href.startsWith(IGDB)).map((c) => c.body);

test("a movie genre goes to TMDB discover as its id, from the movie genre list", async () => {
  const results = await suggestByGenre("movie", "Horror");
  expect(results.map((r) => r.title)).toEqual(["Hollow Bell", "Undated Fright"]);
  const [list, discover] = tmdbCalls();
  expect(list.pathname).toBe("/3/genre/movie/list");
  expect(discover.pathname).toBe("/3/discover/movie");
  expect(discover.searchParams.get("with_genres")).toBe("27");
  expect(discover.searchParams.get("sort_by")).toBe("popularity.desc");
});

test("a TV genre uses the TV list and TV discover", async () => {
  const results = await suggestByGenre("show", "Comedy");
  expect(results.map((r) => [r.mediaType, r.title])).toEqual([
    ["show", "Brass Neighbours"],
    ["show", "Quiet Rooms"],
  ]);
  const [list, discover] = tmdbCalls();
  expect(list.pathname).toBe("/3/genre/tv/list");
  expect(discover.pathname).toBe("/3/discover/tv");
  expect(discover.searchParams.get("with_genres")).toBe("35");
});

test("a game genre goes to IGDB as its id, by rating count", async () => {
  const results = await suggestByGenre("game", "Puzzle");
  expect(results.map((r) => r.title)).toEqual(["Lantern Keep", "Undated Game"]);
  expect(igdbBodies()).toEqual([
    "fields name; limit 500;",
    "fields name,first_release_date,cover.image_id; where genres = (9); sort total_rating_count desc; limit 20;",
  ]);
});

test("a book genre is a Hardcover search on the genres field", async () => {
  const results = await suggestByGenre("book", "Fantasy");
  expect(results.map((r) => r.title)).toEqual(["The Glass Orchard", "Quiet Harbour"]);
  const query = JSON.parse(captured[0].body!).query as string;
  expect(query).toContain('search(query: "Fantasy", query_type: "book", per_page: 20, fields: "genres"');
});

test("a genre the provider doesn't list gives no suggestions and no discover request", async () => {
  expect(await suggestByGenre("movie", "Opera")).toEqual([]);
  expect(tmdbCalls().map((u) => u.pathname)).toEqual(["/3/genre/movie/list"]);
});

test("at most 20 suggestions", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ id: 9500 + i, title: `Invented Film ${i}`, release_date: "2020-01-01" }));
  tmdbRoutes["/discover/movie"] = { results: many };
  expect(SUGGESTION_LIMIT).toBe(20);
  expect(await suggestByGenre("movie", "Horror")).toHaveLength(20);
});

test("success is cached for 12 hours", async () => {
  await suggestByGenre("movie", "Horror");
  expect(cache.cacheLife).toHaveBeenCalledWith(expect.objectContaining({ revalidate: TWELVE_HOURS }));
});

test.each([
  ["movie", "/discover/movie", 429, "TMDB request failed (status 429)"],
  ["show", "/genre/tv/list", 503, "TMDB request failed (status 503)"],
  ["game", "/games", 500, "IGDB request failed (status 500)"],
  ["book", "hardcover", 503, "Hardcover request failed (status 503)"],
] as const)("a failing provider (%s) gives [] and logs only the provider and status", async (type, path, status, line) => {
  failures[path] = status;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const genre = { movie: "Horror", show: "Comedy", game: "Puzzle", book: "Fantasy" }[type];
  expect(await suggestByGenre(type, genre)).toEqual([]);
  expect(error.mock.calls).toEqual([[line]]);
  // A failure is never kept for 12 hours.
  expect(cache.cacheLife).not.toHaveBeenCalledWith(expect.objectContaining({ revalidate: TWELVE_HOURS }));
});

test("INV-006: recommendation requests carry a genre and nothing about the user", async () => {
  // The cache key is the arguments: a media type and a genre, never the user.
  expect(suggestByGenre.length).toBe(2);
  await suggestByGenre("movie", "Horror");
  await suggestByGenre("show", "Comedy");
  await suggestByGenre("game", "Puzzle");
  await suggestByGenre("book", "Fantasy");
  expect(captured.length).toBeGreaterThan(0);
  for (const req of captured) {
    const everything = [req.url.href, ...req.headers.entries(), req.body ?? ""].join("\n");
    for (const secret of [USER_ID, EMAIL, "fern.calder"]) expect(everything).not.toContain(secret);
    if (req.url.href.startsWith(TMDB)) {
      const allowed = req.url.pathname.startsWith("/3/discover/")
        ? ["include_adult", "sort_by", "with_genres"]
        : [];
      expect([...req.url.searchParams.keys()].sort()).toEqual(allowed);
    }
  }
});

test("genre options: a provider's genre list, with the user's known genres, sorted", async () => {
  expect(await genreOptions("movie", ["Horror", "Western"])).toEqual(["Comedy", "Drama", "Horror", "Western"]);
  expect(await genreOptions("game", [])).toEqual(["Puzzle", "Role-playing (RPG)"]);
});

test("genre options for books are the user's own book genres; Hardcover isn't asked", async () => {
  expect(await genreOptions("book", ["Mystery", "Fantasy", "Mystery"])).toEqual(["Fantasy", "Mystery"]);
  expect(captured).toEqual([]);
});

test("genre options when the provider fails: the known genres alone, logged like any failure", async () => {
  failures["/genre/movie/list"] = 500;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await genreOptions("movie", ["Horror"])).toEqual(["Horror"]);
  expect(error.mock.calls).toEqual([["TMDB request failed (status 500)"]]);
});
