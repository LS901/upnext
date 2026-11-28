import type { EntryStatus } from "@/lib/library/status";
import type { QueueType } from "@/lib/library/up-next-order";

/** The types a recommendation row can be for: every type with a provider (not Other). */
export type RecType = Exclude<QueueType, "other">;
export const REC_TYPES: readonly RecType[] = ["movie", "show", "game", "book"];

export const isRecType = (v: string): v is RecType => (REC_TYPES as readonly string[]).includes(v);

/** One library item's genres and status (a show counts once, however many seasons are tracked). */
export type GenreEntry = { mediaType: QueueType; genres: string[]; status: EntryStatus };
export type GenrePin = { mediaType: RecType; genre: string };
export type GenreRow = { mediaType: RecType; genre: string };

/** At most this many rows under the search box, pins included. */
export const MAX_ROWS = 6;
/** Each type offers its top this-many library genres. */
const TOP_PER_TYPE = 2;

/** A row's title: `{Genre} {films|TV|games|books} you might like`. */
const NOUNS: Record<RecType, string> = { movie: "films", show: "TV", game: "games", book: "books" };
export function rowTitle(mediaType: RecType, genre: string): string {
  return `${genre} ${NOUNS[mediaType]} you might like`;
}

/**
 * Which recommendation rows to show: the pins first, in the order pinned; then
 * each type's top 2 genres by how many of the user's entries have them (Dropped
 * and Other left out), ties by genre name. The types take turns (every type's
 * first genre, then every type's second), so one busy type can't crowd the
 * others out. No row twice, and at most MAX_ROWS.
 */
export function pickRows(entries: readonly GenreEntry[], pins: readonly GenrePin[]): GenreRow[] {
  const rows: GenreRow[] = [];
  const seen = new Set<string>();
  const add = (row: GenreRow) => {
    const key = `${row.mediaType}\u0000${row.genre}`;
    if (rows.length >= MAX_ROWS || seen.has(key)) return;
    seen.add(key);
    rows.push({ mediaType: row.mediaType, genre: row.genre });
  };

  for (const pin of pins) add(pin);

  const top = new Map<RecType, string[]>();
  for (const type of REC_TYPES) {
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (e.mediaType !== type || e.status === "dropped") continue;
      for (const genre of new Set(e.genres)) counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
    const ranked = [...counts].sort(([a, n], [b, m]) => m - n || (a < b ? -1 : a > b ? 1 : 0));
    top.set(type, ranked.slice(0, TOP_PER_TYPE).map(([genre]) => genre));
  }
  for (let rank = 0; rank < TOP_PER_TYPE; rank++) {
    for (const type of REC_TYPES) {
      const genre = top.get(type)?.[rank];
      if (genre !== undefined) add({ mediaType: type, genre });
    }
  }
  return rows;
}

/** The distinct genres of the user's items of one type (the options /settings offers beside the provider's). */
export function knownGenres(entries: readonly GenreEntry[], mediaType: RecType): string[] {
  return [...new Set(entries.filter((e) => e.mediaType === mediaType).flatMap((e) => e.genres))];
}

/**
 * The rows for the search page: pickRows without the types hidden by the Hide
 * boxes. A book genre goes to Hardcover as text, so a book pin counts only
 * while it is one of the genres Hardcover gave the user's own books: a pin
 * written straight through the API, past /settings, never sends its words to a
 * provider (INV-006). Movie, TV and game genres go as the provider's id, or not at all.
 */
export function rowsFor(entries: readonly GenreEntry[], pins: readonly GenrePin[], hidden: readonly string[]): GenreRow[] {
  const hide = new Set(hidden);
  const bookGenres = new Set(knownGenres(entries, "book"));
  return pickRows(
    entries.filter((e) => !hide.has(e.mediaType)),
    pins.filter((p) => !hide.has(p.mediaType) && (p.mediaType !== "book" || bookGenres.has(p.genre))),
  );
}
