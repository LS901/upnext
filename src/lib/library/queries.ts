import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { igdbImageUrl } from "@/lib/providers/igdb";
import { tmdbImageUrl } from "@/lib/providers/tmdb";
import type { Provider } from "@/lib/providers/types";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll, fetchAllIn } from "@/lib/supabase/fetch-all";
import { showProgress } from "./progress";
import { LIBRARY_ORDER, STATUS_LABELS, type EntryStatus } from "./status";

type Client = SupabaseClient<Database>;

type Score = { score: number | null; scoreCount: number | null };

/** A movie or game. `minutes` is the runtime (movie) or the story time to beat (game). */
export type ItemRow = Score & {
  kind: "item";
  entryId: string;
  status: EntryStatus;
  mediaType: "movie" | "game";
  title: string;
  imageUrl: string | null;
  minutes: number | null;
};

/** One of the user's seasons: its number and summary only, never a synopsis (INV-004). */
export type SeasonRow = {
  entryId: string;
  status: EntryStatus;
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
};

export type LibraryGroup = { status: EntryStatus; label: string; rows: (ItemRow | ShowRow)[] };

/** The user's library, grouped by status in LIBRARY_ORDER; empty groups are left out. */
export type LibraryView = { groups: LibraryGroup[] };

type Show = Omit<ShowRow, "seasons"> & { seasons: SeasonRow[] };

function imageUrl(provider: Provider, ref: string | null): string | null {
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
        `id, status,
         item:items(provider, media_type, title, image_ref, runtime_minutes, ttb_normally_s, score, score_count),
         season:seasons(id, season_number, episode_count, air_date, runtime_minutes,
           show:items(id, provider, title, image_ref, score, score_count))`,
      )
      .eq("user_id", userId)
      .order("id")
      .range(from, to),
  );

  const items: ItemRow[] = [];
  const shows = new Map<string, Show>();
  for (const e of entries) {
    if (e.item) {
      const i = e.item;
      if (i.media_type === "show") continue; // the schema allows only movies and games here
      items.push({
        kind: "item",
        entryId: e.id,
        status: e.status,
        mediaType: i.media_type,
        title: i.title,
        imageUrl: imageUrl(i.provider, i.image_ref),
        minutes: i.media_type === "movie" ? i.runtime_minutes : storyMinutes(i.ttb_normally_s),
        score: i.score,
        scoreCount: i.score_count,
      });
    } else if (e.season) {
      const s = e.season;
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
        };
        shows.set(show.showId, show);
      }
      show.seasons.push({
        entryId: e.id,
        status: e.status,
        number: s.season_number,
        episodeCount: s.episode_count,
        airDate: s.air_date,
        runtimeMinutes: s.runtime_minutes,
      });
    }
  }

  const finishedSeasonIds = new Set(
    entries.flatMap((e) => (e.season && e.status === "finished" ? [e.season.id] : [])),
  );
  await addProgress(supabase, userId, shows, finishedSeasonIds);

  const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
  const groups: LibraryGroup[] = [];
  for (const status of LIBRARY_ORDER) {
    const rows: (ItemRow | ShowRow)[] = [
      ...items.filter((i) => i.status === status),
      ...[...shows.values()].flatMap((show) => {
        const seasons = show.seasons.filter((s) => s.status === status).sort((a, b) => a.number - b.number);
        return seasons.length ? [{ ...show, seasons }] : [];
      }),
    ].sort(byTitle);
    if (rows.length) groups.push({ status, label: STATUS_LABELS[status], rows });
  }
  return { groups };
}

// Every season of each show counts, not only the ones the user added, minus
// the user's exclusions (a user can exclude a season they never added).
async function addProgress(
  supabase: Client,
  userId: string,
  shows: Map<string, Show>,
  finishedSeasonIds: Set<string>,
): Promise<void> {
  if (!shows.size) return;
  // Chunked and paged, so many shows never make a URL too long or lose
  // seasons past one page.
  const [seasons, exclusions] = await Promise.all([
    fetchAllIn([...shows.keys()], (ids, from, to) =>
      supabase.from("seasons").select("id, show_id, season_number").in("show_id", ids).order("id").range(from, to),
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
  // Up next is a shortlist inside Backlog (the schema allows a position only
  // there), so an entry leaving Backlog leaves it.
  const change = status === "backlog" ? { status } : { status, up_next_position: null };
  const { data, error } = await supabase
    .from("library_entries")
    .update(change)
    .eq("id", entryId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  if (!data.length) throw new Error("That entry isn't in your library.");
}

/**
 * Deletes one of the user's entries. Idempotent: when no row goes, the entry
 * is already gone (a double-click on Remove), which is success. The filter on
 * the user, and RLS, mean another user's entry is never deleted (INV-001),
 * and the same quiet success tells the caller nothing about it.
 */
export async function deleteEntry(supabase: Client, userId: string, entryId: string): Promise<void> {
  const { error } = await supabase.from("library_entries").delete().eq("id", entryId).eq("user_id", userId);
  if (error) throw error;
}
