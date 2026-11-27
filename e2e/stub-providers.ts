// Stub TMDB, IGDB, Hardcover and Twitch for e2e, so the app never calls the real providers.
// playwright.config.ts starts it and points the app at it through
// TMDB_API_BASE_URL, IGDB_API_BASE_URL and TWITCH_TOKEN_URL.
// Run with: node --experimental-strip-types e2e/stub-providers.ts
//
// Search terms with special meaning (anything else returns every fixture):
//   "tmdb-down" → TMDB answers 429; "igdb-down" → IGDB answers 500;
//   "hardcover-down" → Hardcover answers 503; "hardcover-slow" → Hardcover answers
//   only after HARDCOVER_SLOW_MS, past the app's 5 s request timeout;
//   "nothing" → all providers return no results.
//
// GET /__requests lists every TMDB, IGDB and Twitch request received, with its
// search term, so a test can check which calls the app made. Hardcover's are
// listed apart, at /__requests?provider=hardcover, so the specs that count the
// calls of the other providers don't see them.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

const PORT = 3101;

type Json = unknown;
type Logged = { provider: "tmdb" | "igdb" | "twitch" | "hardcover"; path: string; term?: string };

const fixtures = join(import.meta.dirname, "fixtures");
const load = (name: string): Json => JSON.parse(readFileSync(join(fixtures, name), "utf8"));

const tmdbSearch = load("tmdb-search.json");
const tmdbMovies = load("tmdb-movies.json") as Record<string, Json>;
const tmdbShows = load("tmdb-shows.json") as Record<string, Json>;
const tmdbSeasons = load("tmdb-seasons.json") as Record<string, Record<string, Json>>;
const igdbGames = load("igdb-games.json") as { id: number }[];
const igdbTimeToBeats = load("igdb-time-to-beats.json") as { game_id: number }[];

const hardcoverSearch = load("hardcover-search.json");
const hardcoverBooks = load("hardcover-books.json") as Record<string, Json>;

const requests: Logged[] = [];

const HARDCOVER_SLOW_MS = 6500;

function send(res: ServerResponse, status: number, body: Json) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function tmdb(path: string, url: URL, res: ServerResponse) {
  if (path === "/search/multi") {
    const term = url.searchParams.get("query") ?? "";
    requests.push({ provider: "tmdb", path, term });
    if (term.includes("tmdb-down")) return send(res, 429, { status_message: "Too many requests" });
    if (term.includes("nothing")) return send(res, 200, { page: 1, results: [] });
    return send(res, 200, tmdbSearch);
  }
  requests.push({ provider: "tmdb", path });

  let m = path.match(/^\/movie\/(\d+)$/);
  if (m) return tmdbMovies[m[1]] ? send(res, 200, tmdbMovies[m[1]]) : send(res, 404, {});
  m = path.match(/^\/tv\/(\d+)$/);
  if (m) return tmdbShows[m[1]] ? send(res, 200, tmdbShows[m[1]]) : send(res, 404, {});
  m = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/);
  if (m) {
    const season = tmdbSeasons[m[1]]?.[m[2]];
    return season ? send(res, 200, season) : send(res, 404, {});
  }
  send(res, 404, {});
}

function igdb(path: string, body: string, res: ServerResponse) {
  const search = body.match(/search "((?:[^"\\]|\\.)*)"/);
  if (path === "/games" && search) {
    const term = search[1];
    requests.push({ provider: "igdb", path, term });
    if (term.includes("igdb-down")) return send(res, 500, { message: "stub outage" });
    if (term.includes("nothing")) return send(res, 200, []);
    return send(res, 200, igdbGames);
  }
  requests.push({ provider: "igdb", path });

  const id = Number(body.match(/where (?:game_)?id = (\d+)/)?.[1]);
  if (path === "/games") return send(res, 200, igdbGames.filter((g) => g.id === id));
  if (path === "/game_time_to_beats") return send(res, 200, igdbTimeToBeats.filter((t) => t.game_id === id));
  send(res, 404, {});
}

// GraphQL: one top-level field per request, like the real client sends.
function hardcover(body: string, res: ServerResponse) {
  let query = "";
  try {
    query = String((JSON.parse(body) as { query?: unknown }).query ?? "");
  } catch {
    return send(res, 400, {});
  }
  if (query.includes("search(")) {
    const term = query.match(/search\(query: "((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    requests.push({ provider: "hardcover", path: "/graphql", term });
    if (term.includes("hardcover-down")) return send(res, 503, { error: "stub outage" });
    if (term.includes("hardcover-slow")) {
      // The app gives up first; answer anyway unless it has already hung up.
      setTimeout(() => {
        if (!res.destroyed) send(res, 200, hardcoverSearch);
      }, HARDCOVER_SLOW_MS);
      return;
    }
    if (term.includes("nothing")) return send(res, 200, { data: { search: { results: { hits: [] } } } });
    return send(res, 200, hardcoverSearch);
  }
  requests.push({ provider: "hardcover", path: "/graphql" });
  if (query.includes("books_by_pk")) {
    const id = query.match(/books_by_pk\(id: (\d+)\)/)?.[1] ?? "";
    return send(res, 200, { data: { books_by_pk: hardcoverBooks[id] ?? null } });
  }
  send(res, 200, { data: {} });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === "/__health") return send(res, 200, { ok: true });
  if (path === "/__requests") {
    const hardcoverOnly = url.searchParams.get("provider") === "hardcover";
    return send(res, 200, requests.filter((r) => (r.provider === "hardcover") === hardcoverOnly));
  }
  if (path.startsWith("/tmdb/")) return tmdb(path.slice("/tmdb".length), url, res);
  if (path.startsWith("/igdb/") && req.method === "POST") {
    return igdb(path.slice("/igdb".length), await readBody(req), res);
  }
  if (path === "/hardcover" && req.method === "POST") return hardcover(await readBody(req), res);
  if (path === "/twitch/token" && req.method === "POST") {
    requests.push({ provider: "twitch", path });
    return send(res, 200, { access_token: "stub-token", expires_in: 3600, token_type: "bearer" });
  }
  send(res, 404, {});
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Stub providers listening on http://127.0.0.1:${PORT}`);
});
