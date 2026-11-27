import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaType } from "@/lib/providers/types";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { summarise, upcoming, type DashboardStats, type RadarEntry } from "./dashboard-summary";
import { getMyLibrary, imageUrl, type LibraryView } from "./queries";

type Client = SupabaseClient<Database>;

export type FinishedEntry = {
  entryId: string;
  title: string;
  mediaType: MediaType;
  bookVersion: "print" | "audio" | null;
  imageUrl: string | null;
  seasonNumber: number | null;
  finishedAt: string;
};

export type Dashboard = {
  library: LibraryView;
  stats: DashboardStats;
  radar: RadarEntry[];
  recentlyFinished: FinishedEntry[];
};

export const RECENTLY_FINISHED_LIMIT = 6;

const ITEM_COLUMNS = "provider, media_type, title, image_ref, release_date";
const SEASON_COLUMNS = `season_number, air_date, show:items(provider, title, image_ref)`;

/**
 * The signed-in user's dashboard. Pass the user's own client: it can read other
 * users' public entries too, so every query is filtered to `userId` (INV-001).
 * `today` is a YYYY-MM-DD string.
 */
export async function getDashboard(supabase: Client, userId: string, today: string): Promise<Dashboard> {
  const [library, radar, recentlyFinished] = await Promise.all([
    getMyLibrary(supabase, userId),
    getRadar(supabase, userId, today),
    getRecentlyFinished(supabase, userId),
  ]);
  return { library, stats: summarise(library), radar, recentlyFinished };
}

async function getRadar(supabase: Client, userId: string, today: string): Promise<RadarEntry[]> {
  const [itemEntries, seasonEntries] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("library_entries")
        .select(`id, book_version, item:items!inner(${ITEM_COLUMNS})`)
        .eq("user_id", userId)
        .eq("status", "backlog")
        .gt("item.release_date", today)
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("library_entries")
        .select(`id, season:seasons!inner(${SEASON_COLUMNS})`)
        .eq("user_id", userId)
        .eq("status", "backlog")
        .gt("season.air_date", today)
        .order("id")
        .range(from, to),
    ),
  ]);

  const entries: RadarEntry[] = [];
  for (const e of itemEntries) {
    if (!e.item?.release_date) continue;
    entries.push({
      entryId: e.id,
      title: e.item.title,
      mediaType: e.item.media_type,
      bookVersion: e.book_version,
      imageUrl: imageUrl(e.item.provider, e.item.image_ref),
      releaseDate: e.item.release_date,
      seasonNumber: null,
    });
  }
  for (const e of seasonEntries) {
    if (!e.season?.air_date) continue;
    entries.push({
      entryId: e.id,
      title: e.season.show.title,
      mediaType: "show",
      imageUrl: imageUrl(e.season.show.provider, e.season.show.image_ref),
      releaseDate: e.season.air_date,
      seasonNumber: e.season.season_number,
    });
  }
  return upcoming(entries, today);
}

async function getRecentlyFinished(supabase: Client, userId: string): Promise<FinishedEntry[]> {
  const { data, error } = await supabase
    .from("library_entries")
    .select(`id, finished_at, book_version, item:items(${ITEM_COLUMNS}), season:seasons(${SEASON_COLUMNS})`)
    .eq("user_id", userId)
    .eq("status", "finished")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .order("id")
    .limit(RECENTLY_FINISHED_LIMIT);
  if (error) throw error;

  return data.flatMap((e): FinishedEntry[] => {
    if (!e.finished_at) return [];
    if (e.item) {
      return [
        {
          entryId: e.id,
          title: e.item.title,
          mediaType: e.item.media_type,
          bookVersion: e.book_version,
          imageUrl: imageUrl(e.item.provider, e.item.image_ref),
          seasonNumber: null,
          finishedAt: e.finished_at,
        },
      ];
    }
    if (e.season) {
      return [
        {
          entryId: e.id,
          title: e.season.show.title,
          mediaType: "show",
          bookVersion: null,
          imageUrl: imageUrl(e.season.show.provider, e.season.show.image_ref),
          seasonNumber: e.season.season_number,
          finishedAt: e.finished_at,
        },
      ];
    }
    return [];
  });
}
