import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seasonLabel } from "@/app/search/season-label";
import { igdbImageUrl } from "@/lib/providers/igdb";
import { tmdbImageUrl } from "@/lib/providers/tmdb";
import type { Provider } from "@/lib/providers/types";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll, fetchAllIn } from "@/lib/supabase/fetch-all";
import { showProgress } from "./progress";
import { seriesProgress } from "./series-progress";
import { LIBRARY_ORDER, STATUS_LABELS, type EntryStatus } from "./status";
import { QUEUE_TYPES, type QueueType } from "./up-next-order";

type Client = SupabaseClient<Database>;

type Score = { score: number | null; scoreCount: number | null };

/**
 * A movie, game or book entry. `minutes` is the runtime (movie), the story time
 * to beat (game) or the listening time (audiobook). A book's `version` is the
 * entry's own, never read from whether the book has an audiobook; `pages` is
 * set for print, `narrators` for audio, and both are null otherwise.
 */
export type ItemRow = Score & {
  kind: "item";
  entryId: string;
  status: EntryStatus;
  /** Extra plays: 0 until played again (Finished itself is one play). */
  playCount: number;
  mediaType: "movie" | "game" | "book" | "other";
  version: "print" | "audio" | null;
  title: string;
  imageUrl: string | null;
  minutes: number | null;
  pages: number | null;
  narrators: string | null;
  /** Other only: the length the user typed ("24 episodes"), else null. */
  lengthNote: string | null;
  /** For the score label ("Hardcover rating 4.2/5" for a book). */
  providerName: Provider;
};

/** One of the user's seasons: its number and summary only, never a synopsis (INV-004). */
export type SeasonRow = {
  entryId: string;
  status: EntryStatus;
  playCount: number;
  number: number;
  episodeCount: number | null;
  airDate: string | null;
  runtimeMinutes: number | null;
};

/** A show with the user's seasons that are in one status, and its progress over all of them. */
export type ShowRow = Score & {
  kind: "show";
  showId: string;
  title: string;
  imageUrl: string | null;
  progress: { finished: number; total: number };
  seasons: SeasonRow[];
  /** Every season counted (specials left out), whether added or not, for the Progress control. */
  allSeasons: { seasonId: string; number: number; label: string; excluded: boolean }[];
};

/** A book under its series: `position` is its label ("2", "2.5"), or null when unknown. */
export type SeriesBookRow = ItemRow & { position: string | null };

/**
 * A book series with the user's books that are in one status, and its progress
 * over all the user's entries in it. A series has no score of its own.
 */
export type SeriesRow = Score & {
  kind: "series";
  seriesId: string;
  title: string;
  progress: { read: number; total: number };
  books: SeriesBookRow[];
  /** The series' main-line books in `items` (the only ones that count), for the Progress control. */
  allBooks: { itemId: string; label: string; excluded: boolean }[];
};

export type LibraryGroup = { status: EntryStatus; label: string; rows: (ItemRow | ShowRow | SeriesRow)[] };

/** A queued season: shown on its own in the TV queue, with its show's title and poster. */
export type QueuedSeasonRow = Score &
  SeasonRow & { kind: "season"; showTitle: string; imageUrl: string | null };

export type UpNextRow = ItemRow | QueuedSeasonRow;

/**
 * The user's library: the Up next queues, one per media type and each in the
 * user's order, holding every Backlog entry (the database gives each one a
 * place), then everything else grouped by status in LIBRARY_ORDER (empty
 * groups left out).
 */
export type LibraryView = { upNext: Record<QueueType, UpNextRow[]>; groups: LibraryGroup[] };

export function imageUrl(provider: Provider, ref: string | null): string | null {
  if (provider === "manual") return null; // an own entry has no image (a link would reach a stranger's host)
  if (provider === "hardcover") return ref; // the ref is already the full cover URL
  return provider === "tmdb" ? tmdbImageUrl(ref) : igdbImageUrl(ref);
}

/** A game's "normally" time to beat (the main story), stored in seconds. */
const storyMinutes = (seconds: number | null) => (seconds === null ? null : seconds / 60);

/**
 * The signed-in user's library. Pass the user's own client: it can read other
 * users' public entries and exclusions too, so every query is filtered to `userId`.
 */
export async function getMyLibrary(supabase: Client, userId: string): Promise<LibraryView> {
  // Paged: a library can hold more entries than PostgREST returns at once.
  const entries = await fetchAll((from, to) =>
    supabase
      .from("library_entries")
      .select(
        `id, status, play_count, up_next_position,
         book_version,
         item:items(id, provider, media_type, title, image_ref, runtime_minutes, ttb_normally_s, score, score_count,
           page_count, audio_minutes, narrators, length_note, series_position, series_position_label,
           series:book_series(id, name, primary_books_count)),
         season:seasons(id, season_number, episode_count, air_date, runtime_minutes,
           show:items(id, provider, title, image_ref, score, score_count))`,
      )
      .eq("user_id", userId)
      .order("id")
      .range(from, to),
  );

  const items: ItemRow[] = [];
  const shows = new Map<string, ShowRow>();
  const series = new Map<string, { row: SeriesRow; primaryBooksCount: number | null }>();
  // Every book entry in a series, whatever its status, for the series' progress.
  const seriesBooks: SeriesBook[] = [];
  // A series book's position, to sort the books under their series.
  const seriesOrder = new Map<string, number | null>();
  const queued: { type: QueueType; position: number; row: UpNextRow }[] = [];
  for (const e of entries) {
    if (e.item) {
      const i = e.item;
      const mediaType = i.media_type;
      if (mediaType === "show") continue; // the schema never lets an item entry be a show
      const row = itemRow(e.id, e.status, e.play_count, e.book_version, { ...i, media_type: mediaType });
      if (i.media_type === "book" && i.series) {
        seriesBooks.push({
          seriesId: i.series.id,
          itemId: i.id,
          position: i.series_position,
          finished: e.status === "finished",
          excluded: false,
        });
      }
      if (e.up_next_position !== null) {
        // Not started: in the Books queue under its own title, never under its series.
        queued.push({ type: i.media_type, position: e.up_next_position, row });
      } else if (i.media_type === "book" && i.series) {
        let s = series.get(i.series.id);
        if (!s) {
          s = {
            row: {
              kind: "series",
              seriesId: i.series.id,
              title: i.series.name,
              score: null,
              scoreCount: null,
              progress: { read: 0, total: 0 },
              books: [],
              allBooks: [],
            },
            primaryBooksCount: i.series.primary_books_count,
          };
          series.set(i.series.id, s);
        }
        const position = i.series_position_label ?? (i.series_position === null ? null : String(i.series_position));
        s.row.books.push({ ...row, position });
        seriesOrder.set(row.entryId, i.series_position);
      } else items.push(row);
    } else if (e.season) {
      const s = e.season;
      const seasonRow: SeasonRow = {
        entryId: e.id,
        status: e.status,
        playCount: e.play_count,
        number: s.season_number,
        episodeCount: s.episode_count,
        airDate: s.air_date,
        runtimeMinutes: s.runtime_minutes,
      };
      if (e.up_next_position !== null) {
        queued.push({
          type: "show",
          position: e.up_next_position,
          row: {
            ...seasonRow,
            kind: "season",
            showTitle: s.show.title,
            imageUrl: imageUrl(s.show.provider, s.show.image_ref),
            score: s.show.score,
            scoreCount: s.show.score_count,
          },
        });
        continue;
      }
      let show = shows.get(s.show.id);
      if (!show) {
        show = {
          kind: "show",
          showId: s.show.id,
          title: s.show.title,
          imageUrl: imageUrl(s.show.provider, s.show.image_ref),
          score: s.show.score,
          scoreCount: s.show.score_count,
          progress: { finished: 0, total: 0 },
          seasons: [],
          allSeasons: [],
        };
        shows.set(show.showId, show);
      }
      show.seasons.push(seasonRow);
    }
  }

  const finishedSeasonIds = new Set(
    entries.flatMap((e) => (e.season && e.status === "finished" ? [e.season.id] : [])),
  );
  await Promise.all([
    addProgress(supabase, userId, shows, finishedSeasonIds),
    addSeriesProgress(supabase, userId, series, seriesBooks),
  ]);

  // By title; a book's print entry before its audio one.
  const audioLast = (r: ItemRow | ShowRow | SeriesRow) => (r.kind === "item" && r.version === "audio" ? 1 : 0);
  const byTitle = (a: ItemRow | ShowRow | SeriesRow, b: ItemRow | ShowRow | SeriesRow) =>
    a.title.localeCompare(b.title) || audioLast(a) - audioLast(b);
  // Under a series: in series order (unknown positions last), then by title and version.
  const place = (b: SeriesBookRow) => seriesOrder.get(b.entryId) ?? Infinity;
  const inSeriesOrder = (a: SeriesBookRow, b: SeriesBookRow) => place(a) - place(b) || byTitle(a, b);
  const groups: LibraryGroup[] = [];
  for (const status of LIBRARY_ORDER) {
    const rows: (ItemRow | ShowRow | SeriesRow)[] = [
      ...items.filter((i) => i.status === status),
      ...[...shows.values()].flatMap((show) => {
        const seasons = show.seasons.filter((s) => s.status === status).sort((a, b) => a.number - b.number);
        return seasons.length ? [{ ...show, seasons }] : [];
      }),
      ...[...series.values()].flatMap(({ row }) => {
        const books = row.books.filter((b) => b.status === status).sort(inSeriesOrder);
        return books.length ? [{ ...row, books }] : [];
      }),
    ].sort(byTitle);
    if (rows.length) groups.push({ status, label: STATUS_LABELS[status], rows });
  }

  // Each queue in the user's order; ties (two adds at once) settle by entry id,
  // compared as the database orders it (plain order, not locale order).
  queued.sort((x, y) => x.position - y.position || (x.row.entryId < y.row.entryId ? -1 : 1));
  const upNext = Object.fromEntries(
    QUEUE_TYPES.map((type) => [type, queued.filter((q) => q.type === type).map((q) => q.row)]),
  ) as Record<QueueType, UpNextRow[]>;
  return { upNext, groups };
}

type BookVersion = Database["public"]["Enums"]["book_version"];

type CatalogueItem = {
  id: string;
  provider: Provider;
  media_type: "movie" | "game" | "book" | "other";
  title: string;
  image_ref: string | null;
  runtime_minutes: number | null;
  ttb_normally_s: number | null;
  score: number | null;
  score_count: number | null;
  page_count: number | null;
  audio_minutes: number | null;
  narrators: string | null;
  length_note: string | null;
};

function itemRow(
  entryId: string,
  status: EntryStatus,
  playCount: number,
  bookVersion: BookVersion | null,
  i: CatalogueItem,
): ItemRow {
  // A book's version is the entry's own (a book entry always has one), never
  // `has_audiobook`, which is unknown (null) once a book's data is purged.
  const version = i.media_type === "book" ? (bookVersion ?? "print") : null;
  const minutes =
    i.media_type === "movie"
      ? i.runtime_minutes
      : i.media_type === "game"
        ? storyMinutes(i.ttb_normally_s)
        : version === "audio"
          ? i.audio_minutes
          : null;
  return {
    kind: "item",
    entryId,
    status,
    playCount,
    mediaType: i.media_type,
    version,
    title: i.title,
    imageUrl: imageUrl(i.provider, i.image_ref),
    minutes,
    pages: version === "print" ? i.page_count : null,
    narrators: version === "audio" ? i.narrators : null,
    lengthNote: i.media_type === "other" ? i.length_note : null,
    providerName: i.provider,
    score: i.score,
    scoreCount: i.score_count,
  };
}

type SeriesBook = { seriesId: string; itemId: string; position: number | null; finished: boolean; excluded: boolean };

// A series counts every one of the user's entries in it, whatever the status,
// minus the user's book exclusions (a user can exclude a book they never added).
async function addSeriesProgress(
  supabase: Client,
  userId: string,
  series: Map<string, { row: SeriesRow; primaryBooksCount: number | null }>,
  books: SeriesBook[],
): Promise<void> {
  if (!series.size) return;
  // All of the user's exclusions, paged; only those on these series' books match below.
  const exclusions = await fetchAll((from, to) =>
    supabase
      .from("book_exclusions")
      .select("item_id, item:items(series_id, series_position)")
      .eq("user_id", userId)
      .order("item_id")
      .range(from, to),
  );
  const excluded = new Set(exclusions.map((x) => x.item_id));
  const catalogue = await fetchAllIn([...series.keys()], (ids, from, to) =>
    supabase
      .from("items")
      .select("id, title, series_id, series_position, series_position_label")
      .in("series_id", ids)
      .eq("media_type", "book")
      .order("id")
      .range(from, to),
  );
  const all: SeriesBook[] = [
    ...books.map((b) => ({ ...b, excluded: excluded.has(b.itemId) })),
    ...exclusions.flatMap((x) =>
      x.item.series_id
        ? [{ seriesId: x.item.series_id, itemId: x.item_id, position: x.item.series_position, finished: false, excluded: true }]
        : [],
    ),
  ];
  const bySeries = new Map<string, SeriesBook[]>();
  for (const b of all) {
    const list = bySeries.get(b.seriesId) ?? [];
    list.push(b);
    bySeries.set(b.seriesId, list);
  }
  for (const [id, s] of series) s.row.progress = seriesProgress(s.primaryBooksCount, bySeries.get(id) ?? []);

  // The control lists the main-line books, the only ones whose exclusion changes the count.
  const mainLine = catalogue
    .flatMap((b) =>
      b.series_id && b.series_position !== null && Number.isInteger(b.series_position)
        ? [{ ...b, seriesId: b.series_id, position: b.series_position }]
        : [],
    )
    .sort((x, y) => x.position - y.position || x.title.localeCompare(y.title));
  for (const b of mainLine) {
    series.get(b.seriesId)?.row.allBooks.push({
      itemId: b.id,
      label: `#${b.series_position_label ?? b.position} ${b.title}`,
      excluded: excluded.has(b.id),
    });
  }
}

// Every season of each show counts, not only the ones the user added, minus
// the user's exclusions (a user can exclude a season they never added).
async function addProgress(
  supabase: Client,
  userId: string,
  shows: Map<string, ShowRow>,
  finishedSeasonIds: Set<string>,
): Promise<void> {
  if (!shows.size) return;
  // Chunked and paged, so many shows never make a URL too long or lose
  // seasons past one page.
  const [seasons, exclusions] = await Promise.all([
    fetchAllIn([...shows.keys()], (ids, from, to) =>
      supabase
        .from("seasons")
        .select("id, show_id, season_number, episode_count, air_date")
        .in("show_id", ids).order("id").range(from, to),
    ),
    // All of the user's exclusions; only those on these shows' seasons match below.
    fetchAll((from, to) =>
      supabase
        .from("progress_exclusions")
        .select("season_id")
        .eq("user_id", userId)
        .order("season_id")
        .range(from, to),
    ),
  ]);
  const excluded = new Set(exclusions.map((x) => x.season_id));

  const byShow = new Map<string, { id: string; number: number }[]>();
  for (const s of seasons) {
    const list = byShow.get(s.show_id) ?? [];
    list.push({ id: s.id, number: s.season_number });
    byShow.set(s.show_id, list);
  }
  for (const show of shows.values()) {
    show.progress = showProgress(byShow.get(show.showId) ?? [], finishedSeasonIds, excluded);
  }
  // The control's list: every season counted (specials left out), in order.
  for (const s of [...seasons].sort((x, y) => x.season_number - y.season_number)) {
    if (s.season_number < 1) continue;
    shows.get(s.show_id)?.allSeasons.push({
      seasonId: s.id,
      number: s.season_number,
      label: seasonLabel({ number: s.season_number, episodeCount: s.episode_count, airDate: s.air_date }),
      excluded: excluded.has(s.id),
    });
  }
}

/**
 * Sets the status of one of the user's entries. Throws when no row changed:
 * no such entry, or another user's (RLS hides it, INV-001).
 */
export async function setEntryStatus(
  supabase: Client,
  userId: string,
  entryId: string,
  status: EntryStatus,
): Promise<void> {
  // Only the status: the database owns the Up next place, putting an entry
  // that arrives in Backlog at the bottom of its queue and clearing it when the
  // entry leaves.
  const { data, error } = await supabase
    .from("library_entries")
    .update({ status })
    .eq("id", entryId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  if (!data.length) throw new Error("That entry isn't in your library.");
}

/**
 * Deletes one of the user's entries (and, for Other, its item). Idempotent: when no row goes, the entry
 * is already gone (a double-click on Remove), which is success. The filter on
 * the user, and RLS, mean another user's entry is never deleted (INV-001),
 * and the same quiet success tells the caller nothing about it.
 */
export async function deleteEntry(supabase: Client, userId: string, entryId: string): Promise<void> {
  const { data, error } = await supabase
    .from("library_entries")
    .delete()
    .eq("id", entryId)
    .eq("user_id", userId)
    .select("item_id, item_media_type");
  if (error) throw error;
  // An Other entry is the user's own item, so removing the entry removes the item
  // (the entry first: the foreign key restricts). Never a catalogue item. If
  // anything else still points at it (23503), it stays.
  for (const entry of data) {
    if (entry.item_media_type !== "other" || !entry.item_id) continue;
    const removed = await supabase.from("items").delete().eq("id", entry.item_id).eq("owner_id", userId);
    if (removed.error && removed.error.code !== "23503") throw removed.error;
  }
}

/**
 * Counts one more play of a Finished entry of the user's. `expected` is the
 * count the page showed: the update only matches that count, so a repeat (a
 * double-click, a stale page) finds no row and changes nothing, which is
 * success, as with Remove. Another user's entry, or one that isn't Finished,
 * is never changed (INV-001), and says nothing either way. finished_at stays.
 */
export async function playEntryAgain(supabase: Client, userId: string, entryId: string, expected: number): Promise<void> {
  const { error } = await supabase
    .from("library_entries")
    .update({ play_count: expected + 1 })
    .eq("id", entryId)
    .eq("user_id", userId)
    .eq("play_count", expected)
    .eq("status", "finished");
  if (error) throw error;
}
