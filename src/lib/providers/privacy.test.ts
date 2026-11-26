// @vitest-environment node
// INV-006: provider requests carry only the search text and provider IDs,
// never a user id, email or note.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getDetails } from "./index";
import { resetIgdbTokenForTests, searchIgdb } from "./igdb";
import { searchTmdb } from "./tmdb";
import tmdbSearch from "./__fixtures__/tmdb-search.json";
import movie from "./__fixtures__/tmdb-movie.json";
import tv from "./__fixtures__/tmdb-tv.json";
import season0 from "./__fixtures__/tmdb-season-0.json";
import season1 from "./__fixtures__/tmdb-season-1.json";
import season2 from "./__fixtures__/tmdb-season-2.json";
import igdbSearch from "./__fixtures__/igdb-search.json";
import game from "./__fixtures__/igdb-game.json";
import ttb from "./__fixtures__/igdb-time-to-beat.json";

vi.mock("server-only", () => ({}));

// Invented user data, planted where careless code could pick it up.
const USER_ID = "3f0c9a52-7d1e-4b8a-9e61-privacyuser01";
const EMAIL = "quill.marrow@example.test";
const NOTE = "INVENTED-NOTE: rewatch the lighthouse episode";

const cookieJar = vi.hoisted(() => ({
  values: [] as { name: string; value: string }[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => cookieJar.values,
    get: (name: string) => cookieJar.values.find((c) => c.name === name),
  }),
  headers: async () => new Headers({ cookie: cookieJar.values.map((c) => `${c.name}=${c.value}`).join("; ") }),
}));

const TMDB = "http://tmdb.test/3";
const IGDB = "http://igdb.test/v4";
const TWITCH = "http://twitch.test/oauth2/token";

type Captured = { url: URL; method: string; headers: Headers; body: string | null };
let captured: Captured[] = [];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const TMDB_ROUTES: Record<string, unknown> = {
  "/search/multi": tmdbSearch,
  "/movie/9001": movie,
  "/tv/9002": tv,
  "/tv/9002/season/0": season0,
  "/tv/9002/season/1": season1,
  "/tv/9002/season/2": season2,
};

beforeEach(() => {
  resetIgdbTokenForTests();
  captured = [];
  vi.stubEnv("TMDB_API_BASE_URL", TMDB);
  vi.stubEnv("IGDB_API_BASE_URL", IGDB);
  vi.stubEnv("TWITCH_TOKEN_URL", TWITCH);
  vi.stubEnv("TMDB_API_READ_ACCESS_TOKEN", "tmdb-token");
  vi.stubEnv("IGDB_CLIENT_ID", "igdb-cid");
  vi.stubEnv("IGDB_CLIENT_SECRET", "igdb-csecret");
  vi.stubEnv("UPNEXT_TEST_USER_ID", USER_ID);
  vi.stubEnv("UPNEXT_TEST_USER_EMAIL", EMAIL);
  vi.stubEnv("UPNEXT_TEST_NOTE", NOTE);
  cookieJar.values = [
    { name: "sb-127-auth-token", value: JSON.stringify({ user: { id: USER_ID, email: EMAIL } }) },
    { name: "draft-note", value: NOTE },
  ];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const body = init?.body == null ? null : String(init.body);
      captured.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body });

      if (url.href.startsWith(TWITCH)) return json({ access_token: "tok", expires_in: 3600 });
      if (url.href.startsWith(TMDB)) {
        const route = TMDB_ROUTES[url.pathname.replace("/3", "")];
        return route === undefined ? new Response("{}", { status: 404 }) : json(route);
      }
      if (url.href.startsWith(IGDB)) {
        if (url.pathname.endsWith("/game_time_to_beats")) return json(ttb);
        return json(body?.startsWith("search") ? igdbSearch : game);
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ALLOWED_HEADERS = new Set(["authorization", "client-id", "accept", "content-type"]);

const IGDB_BODIES = new Set([
  'search "lantern"; fields name,first_release_date,cover.image_id; limit 10;',
  "fields name,first_release_date,cover.image_id,total_rating,total_rating_count; where id = 5001; limit 1;",
  "fields hastily,normally,completely,count; where game_id = 5001;",
]);

/** The token request's only allowed form body. The secret never goes in the URL. */
const TWITCH_BODY = { client_id: "igdb-cid", client_secret: "igdb-csecret", grant_type: "client_credentials" };

/** The only query parameters each endpoint may carry, with their only allowed values. */
function allowedQuery(url: URL): Record<string, string> | null {
  const path = url.href.startsWith(TWITCH) ? "twitch" : url.pathname;
  if (path === "twitch") return {};
  if (path === "/3/search/multi") return { query: "lantern", include_adult: "false" };
  if (/^\/3\/(movie\/9001|tv\/9002|tv\/9002\/season\/[0-2])$/.test(path)) return {};
  if (path === "/v4/games" || path === "/v4/game_time_to_beats") return {};
  return null;
}

test("INV-006: provider requests carry only the endpoint, search text and provider IDs", async () => {
  await searchTmdb("lantern");
  await searchIgdb("lantern");
  await getDetails("tmdb", "movie", "9001");
  await getDetails("tmdb", "show", "9002");
  await getDetails("igdb", "game", "5001");

  // 1 TMDB search, 1 token + 1 IGDB search, 1 movie, 1 show + 3 seasons, 2 IGDB details
  expect(captured).toHaveLength(10);

  for (const req of captured) {
    const where = `${req.method} ${req.url.href}`;

    const allowed = allowedQuery(req.url);
    expect(allowed, `unexpected endpoint: ${where}`).not.toBeNull();
    expect(Object.fromEntries(req.url.searchParams), where).toEqual(allowed);
    expect(req.url.hash, where).toBe("");
    expect(req.url.username + req.url.password, where).toBe("");

    for (const name of req.headers.keys()) {
      expect(ALLOWED_HEADERS.has(name), `header ${name} on ${where}`).toBe(true);
    }

    if (req.url.href.startsWith(IGDB)) {
      expect(IGDB_BODIES.has(req.body ?? ""), `IGDB body on ${where}: ${req.body}`).toBe(true);
    } else if (req.url.href.startsWith(TWITCH)) {
      expect(req.method, where).toBe("POST");
      expect(req.headers.get("content-type"), where).toBe("application/x-www-form-urlencoded");
      expect(Object.fromEntries(new URLSearchParams(req.body ?? "")), where).toEqual(TWITCH_BODY);
    } else {
      expect(req.body, where).toBeNull();
    }

    const everything = [req.url.href, ...req.headers.entries(), req.body ?? ""].join("\n");
    for (const secret of [USER_ID, EMAIL, NOTE, "quill.marrow", "INVENTED-NOTE"]) {
      expect(everything, where).not.toContain(secret);
    }
  }
});
