import "server-only";
import {
  ProviderError,
  type Genre,
  type ItemDetails,
  type SearchResult,
  type SeasonDetails,
  type SeasonSummary,
  type ShowSeasons,
} from "./types";

const DEFAULT_BASE_URL = "https://api.themoviedb.org/3";

type Json = Record<string, unknown>;

async function tmdbGet(path: string, params?: Record<string, string>): Promise<Json> {
  const base = (process.env.TMDB_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_READ_ACCESS_TOKEN ?? ""}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("tmdb", null, "tmdb request failed (network)");
  }
  if (!res.ok) throw new ProviderError("tmdb", res.status);
  try {
    return (await res.json()) as Json;
  } catch {
    throw new ProviderError("tmdb", res.status, "tmdb returned invalid JSON");
  }
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

/** A positive runtime in minutes; TMDB uses 0 or null for unknown. */
const minutes = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n > 0 ? n : null;
};

/** TMDB vote_average (0-10) to 0-100, 2 decimals; anything out of range is null. */
function normaliseScore(voteAverage: unknown, voteCount: unknown): number | null {
  if (typeof voteAverage !== "number" || !Number.isFinite(voteAverage)) return null;
  const count = int(voteCount);
  if (!count || count <= 0) return null; // no votes: unknown, not 0
  const score = Math.round(voteAverage * 10 * 100) / 100;
  return score >= 0 && score <= 100 ? score : null;
}

function yearOf(date: string | null): number | null {
  const m = date?.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function tmdbImageUrl(path: string | null, size = "w342"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

/** A search or discover result; a movie has a title and release date, a show a name and first air date. */
function toResult(r: Json, mediaType: "movie" | "show"): SearchResult | null {
  const isMovie = mediaType === "movie";
  const title = str(isMovie ? r.title : r.name);
  if (title === null || r.id == null) return null;
  return {
    provider: "tmdb",
    providerId: String(r.id),
    mediaType,
    title,
    year: yearOf(str(isMovie ? r.release_date : r.first_air_date)),
    imageUrl: tmdbImageUrl(str(r.poster_path)),
  };
}

const resultsOf = (body: Json): Json[] => (Array.isArray(body.results) ? (body.results as Json[]) : []);

export async function searchTmdb(query: string): Promise<SearchResult[]> {
  const body = await tmdbGet("/search/multi", { query, include_adult: "false" });
  const out: SearchResult[] = [];
  for (const r of resultsOf(body)) {
    if (r.media_type !== "movie" && r.media_type !== "tv") continue;
    const result = toResult(r, r.media_type === "movie" ? "movie" : "show");
    if (result) out.push(result);
  }
  return out;
}

/** The genre names of a movie or show, once each, in TMDB's order; unnamed ones are dropped. */
function genreNames(v: unknown): string[] {
  const list = Array.isArray(v) ? (v as Json[]) : [];
  return [...new Set(list.map((g) => str(g?.name)).filter((n): n is string => n !== null))];
}

/** TMDB's genre list for movies or for TV (the two lists differ). */
export async function getTmdbGenres(mediaType: "movie" | "show"): Promise<Genre[]> {
  const body = await tmdbGet(`/genre/${mediaType === "movie" ? "movie" : "tv"}/list`);
  const list = Array.isArray(body.genres) ? (body.genres as Json[]) : [];
  return list.flatMap((g) => {
    const id = int(g?.id);
    const name = str(g?.name);
    return id !== null && name !== null ? [{ id: String(id), name }] : [];
  });
}

/**
 * The most popular movies or shows in one genre (one page, at most 20). The
 * request carries only the genre id (INV-006).
 */
export async function discoverTmdb(mediaType: "movie" | "show", genreId: string): Promise<SearchResult[]> {
  const body = await tmdbGet(`/discover/${mediaType === "movie" ? "movie" : "tv"}`, {
    with_genres: genreId,
    sort_by: "popularity.desc",
    include_adult: "false",
  });
  return resultsOf(body).flatMap((r) => toResult(r, mediaType) ?? []);
}

const MAX_SEASON_REQUESTS = 5;

type ListedSeason = { entry: Json; number: number };

/**
 * A show's `seasons` list, one entry per season number (the first wins). An
 * entry with no number is dropped rather than read as season 0 (Specials).
 */
function listedSeasons(d: Json): ListedSeason[] {
  const list = Array.isArray(d.seasons) ? (d.seasons as Json[]) : [];
  const seen = new Set<number>();
  const out: ListedSeason[] = [];
  for (const entry of list) {
    const number = int(entry.season_number);
    if (number === null || seen.has(number)) continue;
    seen.add(number);
    out.push({ entry, number });
  }
  return out;
}

/** The fields read from an entry in a show's `seasons` list; never its overview. */
function seasonSummary({ entry: s, number }: ListedSeason): SeasonSummary {
  return { number, episodeCount: int(s.episode_count), airDate: str(s.air_date) };
}

async function getSeason(tvId: string, listed: ListedSeason): Promise<SeasonDetails> {
  const s = listed.entry;
  const { number, episodeCount, airDate } = seasonSummary(listed);
  const season = { number, title: str(s.name), episodeCount, airDate };
  // Only episode runtimes are read; overviews and episode titles are ignored.
  // A failed season request (404, 429, 5xx) costs that season its runtime,
  // not the whole show.
  let detail: Json;
  try {
    detail = await tmdbGet(`/tv/${encodeURIComponent(tvId)}/season/${number}`);
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    return { ...season, runtimeMinutes: null, runtimeUnavailable: true };
  }
  const episodes = Array.isArray(detail.episodes) ? (detail.episodes as Json[]) : [];
  const runtimes = episodes.map((e) => minutes(e.runtime)).filter((r): r is number => r !== null);
  return {
    ...season,
    runtimeMinutes: runtimes.length ? runtimes.reduce((a, b) => a + b, 0) : null,
    runtimeUnavailable: false,
  };
}

/** Maps every item with at most `limit` calls in flight, keeping the order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * A show's title and season list from its summary alone: one request, no
 * season details, so no runtimes (and no overviews, INV-004).
 */
export async function getTmdbShowSeasons(id: string): Promise<ShowSeasons> {
  const d = await tmdbGet(`/tv/${encodeURIComponent(id)}`);
  const title = str(d.name);
  if (title === null) throw new ProviderError("tmdb", null, "tmdb details had no title");
  return { title, seasons: listedSeasons(d).map(seasonSummary) };
}

export async function getTmdbDetails(
  mediaType: "movie" | "show",
  id: string,
): Promise<ItemDetails> {
  const isMovie = mediaType === "movie";
  const d = await tmdbGet(`/${isMovie ? "movie" : "tv"}/${encodeURIComponent(id)}`);
  const title = str(isMovie ? d.title : d.name);
  if (title === null) throw new ProviderError("tmdb", null, "tmdb details had no title");

  let seasons: SeasonDetails[] | null = null;
  if (!isMovie) {
    seasons = await mapLimited(listedSeasons(d), MAX_SEASON_REQUESTS, (s) => getSeason(id, s));
  }

  return {
    provider: "tmdb",
    mediaType,
    providerId: id,
    title,
    imageRef: str(d.poster_path),
    releaseDate: str(isMovie ? d.release_date : d.first_air_date),
    runtimeMinutes: isMovie ? minutes(d.runtime) : null,
    score: normaliseScore(d.vote_average, d.vote_count),
    scoreCount: minutes(d.vote_count), // positive count, else unknown (null)
    timeToBeat: null,
    timeToBeatUnavailable: false,
    seasons,
    book: null,
    genres: genreNames(d.genres),
  };
}
