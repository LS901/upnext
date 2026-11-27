import "server-only";
import { ProviderError, type BookDetails, type ItemDetails, type SearchResult } from "./types";

const DEFAULT_URL = "https://api.hardcover.app/v1/graphql";
const USER_AGENT = "upnext (https://github.com/LS901/upnext)";
const MIN_GAP_MS = 1000;
/** Every request gives up after this long, so a slow Hardcover never holds a page up. */
const REQUEST_TIMEOUT_MS = 5000;
/** A search gives up rather than wait longer than this for its turn. */
const SEARCH_MAX_WAIT_MS = 3000;

type Json = Record<string, unknown>;

// ---- Limiter: requests start at least 1 second apart -------------------------
//
// FIFO: each request books its turn when it joins (the earliest start 1 second
// after the turn before it), so its wait is known at once. A search that would
// wait too long gives up before booking, so it never delays the requests behind it.

let lastStart = -Infinity;
let nextTurn = -Infinity;
let gate: Promise<void> = Promise.resolve();

export function resetHardcoverLimiterForTests(): void {
  lastStart = -Infinity;
  nextTurn = -Infinity;
  gate = Promise.resolve();
}

function throttle(maxWaitMs: number): Promise<void> {
  const now = Date.now();
  const turn = Math.max(now, nextTurn);
  if (turn - now > maxWaitMs) return Promise.reject(new ProviderError("hardcover", null));
  nextTurn = turn + MIN_GAP_MS;
  const next = gate.then(async () => {
    // A late timer can't bring two starts closer than the gap.
    const wait = Math.max(turn, lastStart + MIN_GAP_MS) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
    nextTurn = Math.max(nextTurn, lastStart + MIN_GAP_MS);
  });
  gate = next.catch(() => undefined);
  return next;
}

// ---- Request -------------------------------------------------------------------

function authHeader(): string {
  const raw = (process.env.HARDCOVER_API_TOKEN ?? "").trim();
  return `Bearer ${raw.replace(/^Bearer\s+/i, "")}`;
}

/**
 * One GraphQL request with exactly one top-level field. Errors carry the status only (INV-006).
 * `maxWaitMs` caps the wait for a turn; any request gives up after REQUEST_TIMEOUT_MS.
 */
async function hardcoverQuery(query: string, maxWaitMs = Infinity): Promise<Json> {
  await throttle(maxWaitMs);
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(process.env.HARDCOVER_API_URL || DEFAULT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader(),
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
      signal,
    });
  } catch {
    // A timeout or abort, like a network failure, has no status.
    if (signal.aborted) throw new ProviderError("hardcover", null);
    throw new ProviderError("hardcover", null, "hardcover request failed (network)");
  }
  if (!res.ok) throw new ProviderError("hardcover", res.status);
  let body: Json;
  try {
    body = (await res.json()) as Json;
  } catch {
    // The timeout also covers reading the body.
    if (signal.aborted) throw new ProviderError("hardcover", null);
    throw new ProviderError("hardcover", res.status, "hardcover returned invalid JSON");
  }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw new ProviderError("hardcover", res.status, "hardcover request failed (graphql error)");
  }
  const data = body.data;
  if (!data || typeof data !== "object") {
    throw new ProviderError("hardcover", res.status, "hardcover returned no data");
  }
  return data as Json;
}

// ---- Helpers (null, never 0) ---------------------------------------------------

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const positive = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/** Covers render unoptimized, so remotePatterns can't police them: only Hardcover's own CDN is kept. */
const COVER_ORIGIN = "https://assets.hardcover.app/";

/** The image field is an object with a url; tolerate a bare string. Any other host gives the placeholder. */
const imageUrl = (v: unknown): string | null => {
  const url = str(v) ?? str(obj(v)?.url);
  return url !== null && url.startsWith(COVER_ORIGIN) ? url : null;
};

const escapeLiteral = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// ---- Public API ----------------------------------------------------------------

export async function searchHardcover(query: string): Promise<SearchResult[]> {
  // A search gives up rather than queue behind Add imports and the refresh for long.
  const data = await hardcoverQuery(
    `{ search(query: "${escapeLiteral(query)}", query_type: "book", per_page: 10) { results } }`,
    SEARCH_MAX_WAIT_MS,
  );
  const hits = obj(obj(data.search)?.results)?.hits;
  const out: SearchResult[] = [];
  if (!Array.isArray(hits)) return out;
  for (const hit of hits) {
    // Only these fields are read; the book's description is never mapped.
    const doc = obj(obj(hit)?.document);
    if (!doc) continue;
    const title = str(doc.title);
    const id = num(doc.id);
    if (title === null || id === null) continue;
    const year = num(doc.release_year);
    out.push({
      provider: "hardcover",
      providerId: String(id),
      mediaType: "book",
      title,
      year: year !== null ? Math.trunc(year) : null,
      imageUrl: imageUrl(doc.image),
      hasAudiobook: doc.has_audiobook === true,
    });
  }
  return out;
}

function pickSeries(rows: unknown): BookDetails["series"] {
  if (!Array.isArray(rows)) return null;
  const entries = rows.flatMap((r) => {
    const row = obj(r);
    const series = obj(row?.series);
    const id = num(series?.id);
    const name = str(series?.name);
    return row && series && id !== null && name !== null ? [{ row, series, id, name }] : [];
  });
  // The featured series wins; with none featured, the lowest series id.
  const chosen = entries.find((e) => e.row.featured === true) ?? [...entries].sort((a, b) => a.id - b.id)[0];
  if (!chosen) return null;
  return {
    providerId: String(chosen.id),
    name: chosen.name,
    primaryBooksCount: positive(chosen.series.primary_books_count),
    isCompleted: typeof chosen.series.is_completed === "boolean" ? chosen.series.is_completed : null,
    position: num(chosen.row.position),
    positionLabel: str(chosen.row.details),
  };
}

function narratorsOf(edition: Json | null): string[] {
  const contributions = edition?.contributions;
  if (!Array.isArray(contributions)) return [];
  const names: string[] = [];
  for (const c of contributions) {
    const row = obj(c);
    if (str(obj(row?.contributor_role)?.slug) !== "narrator") continue;
    const name = str(obj(row?.author)?.name);
    if (name !== null && !names.includes(name)) names.push(name);
  }
  return names;
}

export async function getHardcoverDetails(id: string): Promise<ItemDetails> {
  if (!/^\d+$/.test(id)) throw new ProviderError("hardcover", null, "hardcover id must be numeric");
  const data = await hardcoverQuery(
    `{ books_by_pk(id: ${id}) { id title pages rating ratings_count release_date image { url } ` +
      `default_audio_edition { audio_seconds contributions { author { name } contributor_role { slug } } } ` +
      `book_series { position details featured series { id name primary_books_count is_completed } } } }`,
  );
  const b = obj(data.books_by_pk);
  const title = b ? str(b.title) : null;
  if (!b || title === null) throw new ProviderError("hardcover", null, "hardcover details had no title");

  const edition = obj(b.default_audio_edition);
  const seconds = positive(edition?.audio_seconds);
  const rating = num(b.rating);
  const count = positive(b.ratings_count);
  const score =
    rating !== null && count !== null && rating >= 0 && rating <= 5 ? Math.round(rating * 20 * 100) / 100 : null;

  return {
    provider: "hardcover",
    mediaType: "book",
    providerId: id,
    title,
    imageRef: imageUrl(b.image),
    releaseDate: str(b.release_date),
    runtimeMinutes: null,
    score,
    scoreCount: score === null ? null : count,
    timeToBeat: null,
    timeToBeatUnavailable: false,
    seasons: null,
    book: {
      pageCount: positive(b.pages),
      audioMinutes: seconds !== null ? Math.round(seconds / 60) : null,
      hasAudiobook: edition !== null,
      narrators: narratorsOf(edition),
      series: pickSeries(b.book_series),
    },
  };
}
