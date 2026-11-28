import "server-only";
import { cacheLife } from "next/cache";
import { logProviderFailure } from "@/app/search/shared";
import { discoverHardcover } from "@/lib/providers/hardcover";
import { discoverIgdb, getIgdbGenres } from "@/lib/providers/igdb";
import { discoverTmdb, getTmdbGenres } from "@/lib/providers/tmdb";
import { ProviderError, type Genre, type Provider, type SearchResult } from "@/lib/providers/types";
import type { RecType } from "./genres";

/** A provider's suggestions per genre, before the page drops the ones the user owns. */
export const SUGGESTION_LIMIT = 20;

// Every cache below is keyed on its arguments alone: a media type and a genre,
// never the user, so no user data reaches a provider and one user's cache entry
// is anyone's (INV-006).

/** Success is kept for 12 hours, then refreshed in the background. */
const TWELVE_HOURS = { revalidate: 12 * 60 * 60, expire: 24 * 60 * 60 };

/**
 * What a cached call returns. A failure is returned, not thrown: an error
 * crossing a cache boundary is serialized and loses its type and status. It is
 * kept for seconds only, so an outage never sticks for 12 hours.
 */
type Outcome<T> = { ok: true; value: T } | { ok: false; provider: Provider; status: number | null };

async function attempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    return { ok: false, provider: err.provider, status: err.status };
  }
}

/** A provider's genre list for a type (books have none: Hardcover has no cheap genre list). */
async function cachedGenres(mediaType: RecType): Promise<Outcome<Genre[]>> {
  "use cache";
  const out = await attempt(async () => {
    if (mediaType === "movie" || mediaType === "show") return getTmdbGenres(mediaType);
    if (mediaType === "game") return getIgdbGenres();
    return [];
  });
  if (out.ok) cacheLife("days");
  else cacheLife("seconds");
  return out;
}

async function cachedSuggestions(mediaType: RecType, genre: string): Promise<Outcome<SearchResult[]>> {
  "use cache";
  let out: Outcome<SearchResult[]>;
  if (mediaType === "book") {
    // Hardcover searches the genre name itself, on the search path (3 s queue cap).
    out = await attempt(() => discoverHardcover(genre));
  } else {
    const genres = await cachedGenres(mediaType);
    if (!genres.ok) {
      out = genres;
    } else {
      const id = genres.value.find((g) => g.name === genre)?.id;
      out = id === undefined ? { ok: true, value: [] } : await attempt(() => (mediaType === "game" ? discoverIgdb(id) : discoverTmdb(mediaType, id)));
    }
  }
  if (out.ok) cacheLife(TWELVE_HOURS);
  else cacheLife("seconds");
  return out;
}

const failed = (out: { provider: Provider; status: number | null }) =>
  logProviderFailure(new ProviderError(out.provider, out.status));

/**
 * Up to SUGGESTION_LIMIT items in one genre, from the type's provider, cached
 * 12 hours per (type, genre). Any provider failure gives [] and logs only
 * `{Provider} request failed (status N)`.
 */
export async function suggestByGenre(mediaType: RecType, genre: string): Promise<SearchResult[]> {
  const out = await cachedSuggestions(mediaType, genre);
  if (!out.ok) {
    failed(out);
    return [];
  }
  return out.value.slice(0, SUGGESTION_LIMIT);
}

/**
 * The genres /settings offers for a type: the provider's genre list (cached)
 * together with `known`, the genres of the user's own items of that type,
 * sorted. Books have only the known ones. A failing provider leaves the known ones.
 */
export async function genreOptions(mediaType: RecType, known: readonly string[]): Promise<string[]> {
  const out = await cachedGenres(mediaType);
  if (!out.ok) failed(out);
  const names = out.ok ? out.value.map((g) => g.name) : [];
  return [...new Set([...names, ...known])].sort((a, b) => a.localeCompare(b));
}
