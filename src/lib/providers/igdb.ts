import "server-only";
import { ProviderError, type ItemDetails, type SearchResult, type TimeToBeat } from "./types";

const DEFAULT_BASE_URL = "https://api.igdb.com/v4";
const DEFAULT_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TOKEN_MARGIN_MS = 60_000;
const MAX_PER_SECOND = 4;

type Json = Record<string, unknown>;

const trimSlashes = (s: string) => s.replace(/\/+$/, "");

// ---- App token (module state) ----------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

export function resetIgdbTokenForTests(): void {
  cachedToken = null;
  tokenInFlight = null;
  starts.length = 0;
  gate = Promise.resolve();
}

async function fetchToken(): Promise<string> {
  const url = new URL(process.env.TWITCH_TOKEN_URL || DEFAULT_TOKEN_URL);
  url.searchParams.set("client_id", process.env.IGDB_CLIENT_ID ?? "");
  url.searchParams.set("client_secret", process.env.IGDB_CLIENT_SECRET ?? "");
  url.searchParams.set("grant_type", "client_credentials");

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", cache: "no-store" });
  } catch {
    throw new ProviderError("igdb", null, "igdb token request failed (network)");
  }
  if (!res.ok) throw new ProviderError("igdb", res.status, `igdb token request failed (${res.status})`);
  let body: Json;
  try {
    body = (await res.json()) as Json;
  } catch {
    throw new ProviderError("igdb", res.status, "igdb token response was invalid JSON");
  }
  const token = body.access_token;
  const expiresIn = body.expires_in;
  if (typeof token !== "string" || token === "" || typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    throw new ProviderError("igdb", res.status, "igdb token response was malformed");
  }
  cachedToken = { value: token, expiresAt: Date.now() + expiresIn * 1000 - TOKEN_MARGIN_MS };
  return token;
}

function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return Promise.resolve(cachedToken.value);
  tokenInFlight ??= fetchToken().finally(() => {
    tokenInFlight = null;
  });
  return tokenInFlight;
}

// ---- Throttle: at most 4 requests started per second -----------------------

const starts: number[] = [];
let gate: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const next = gate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (starts.length && now - starts[0] >= 1000) starts.shift();
      if (starts.length < MAX_PER_SECOND) {
        starts.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, starts[0] + 1000 - now));
    }
  });
  gate = next.catch(() => undefined);
  return next;
}

// ---- Requests ----------------------------------------------------------------

async function igdbPost(endpoint: string, body: string): Promise<Json[]> {
  const base = trimSlashes(process.env.IGDB_API_BASE_URL || DEFAULT_BASE_URL);

  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    await throttle();

    let res: Response;
    try {
      res = await fetch(`${base}${endpoint}`, {
        method: "POST",
        headers: {
          "Client-ID": process.env.IGDB_CLIENT_ID ?? "",
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body,
        cache: "no-store",
      });
    } catch {
      throw new ProviderError("igdb", null, "igdb request failed (network)");
    }

    if (res.status === 401 && attempt === 0) {
      if (cachedToken?.value === token) cachedToken = null; // refetch once, then retry
      continue;
    }
    if (!res.ok) throw new ProviderError("igdb", res.status);
    try {
      const json = await res.json();
      return Array.isArray(json) ? (json as Json[]) : [];
    } catch {
      throw new ProviderError("igdb", res.status, "igdb returned invalid JSON");
    }
  }
}

// ---- Helpers (null, never 0) -------------------------------------------------

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

/** A positive count or duration; IGDB leaves out or zeroes unknown values. */
const positive = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n > 0 ? n : null;
};

/** total_rating is already 0-100; out of range or no ratings is null. */
function normaliseScore(rating: unknown, count: unknown): number | null {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  if (positive(count) === null) return null;
  const score = Math.round(rating * 100) / 100;
  return score >= 0 && score <= 100 ? score : null;
}

/** first_release_date is unix seconds; returned as a UTC ISO date. */
function isoDate(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const d = new Date(v * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const coverId = (g: Json): string | null =>
  g.cover && typeof g.cover === "object" ? str((g.cover as Json).image_id) : null;

/** IGDB image URL; verified against https://api-docs.igdb.com/#images. */
export function igdbImageUrl(imageId: string | null, size = "cover_big"): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : null;
}

/** Escape for an Apicalypse string literal: backslash first, then double quote. */
const escapeLiteral = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// ---- Public API --------------------------------------------------------------

export async function searchIgdb(query: string): Promise<SearchResult[]> {
  const rows = await igdbPost(
    "/games",
    `search "${escapeLiteral(query)}"; fields name,first_release_date,cover.image_id; limit 10;`,
  );
  const out: SearchResult[] = [];
  for (const g of rows) {
    const title = str(g.name);
    if (title === null || g.id == null) continue;
    const date = isoDate(g.first_release_date);
    out.push({
      provider: "igdb",
      providerId: String(g.id),
      mediaType: "game",
      title,
      year: date ? Number(date.slice(0, 4)) : null,
      imageUrl: igdbImageUrl(coverId(g)),
    });
  }
  return out;
}

export async function getIgdbDetails(id: string): Promise<ItemDetails> {
  if (!/^\d+$/.test(id)) throw new ProviderError("igdb", null, "igdb id must be numeric");

  const [games, beats] = await Promise.all([
    igdbPost(
      "/games",
      `fields name,first_release_date,cover.image_id,total_rating,total_rating_count; where id = ${id}; limit 1;`,
    ),
    igdbPost("/game_time_to_beats", `fields hastily,normally,completely,count; where game_id = ${id};`),
  ]);

  const g = games[0];
  const title = g ? str(g.name) : null;
  if (!g || title === null) throw new ProviderError("igdb", null, "igdb details had no title");

  const row = beats[0];
  const timeToBeat: TimeToBeat | null = row
    ? {
        hastilyS: positive(row.hastily),
        normallyS: positive(row.normally),
        completelyS: positive(row.completely),
        count: positive(row.count),
      }
    : null;

  return {
    provider: "igdb",
    mediaType: "game",
    providerId: id,
    title,
    imageRef: coverId(g),
    releaseDate: isoDate(g.first_release_date),
    runtimeMinutes: null,
    score: normaliseScore(g.total_rating, g.total_rating_count),
    scoreCount: positive(g.total_rating_count),
    timeToBeat,
    seasons: null,
  };
}
