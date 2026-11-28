import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntryStatus } from "@/lib/library/status";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { GenreEntry, GenrePin, RecType } from "./genres";

type Client = SupabaseClient<Database>;

/**
 * The genres of the user's library, one entry per item: a show once however
 * many of its seasons are tracked, a book once for print and audio. An item
 * counts as Dropped only when every entry of it is. Pass the user's own client;
 * it can read other users' public entries, so the query is filtered to `userId`.
 */
export async function getGenreEntries(supabase: Client, userId: string): Promise<GenreEntry[]> {
  const rows = await fetchAll((from, to) =>
    supabase
      .from("library_entries")
      .select("status, item:items(id, media_type, genres), season:seasons(show:items(id, media_type, genres))")
      .eq("user_id", userId)
      .order("id")
      .range(from, to),
  );

  const byItem = new Map<string, { entry: GenreEntry; statuses: Set<EntryStatus> }>();
  for (const row of rows) {
    const item = row.item ?? row.season?.show;
    if (!item) continue;
    let found = byItem.get(item.id);
    if (!found) {
      found = { entry: { mediaType: item.media_type, genres: item.genres, status: row.status }, statuses: new Set() };
      byItem.set(item.id, found);
    }
    found.statuses.add(row.status);
  }
  return [...byItem.values()].map(({ entry, statuses }) => {
    const kept = [...statuses].find((s) => s !== "dropped");
    return { ...entry, status: kept ?? "dropped" };
  });
}

/** The user's genre pins, in the order pinned. Filtered to `userId` like every user query. */
export async function getPins(supabase: Client, userId: string): Promise<GenrePin[]> {
  const { data, error } = await supabase
    .from("user_genre_pins")
    .select("media_type, genre")
    .eq("user_id", userId)
    .order("created_at")
    .order("genre");
  if (error) throw error;
  return data.flatMap((p) => (p.media_type === "other" ? [] : [{ mediaType: p.media_type as RecType, genre: p.genre }]));
}
