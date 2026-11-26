import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaType, Provider } from "@/lib/providers/types";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type ItemKey = `${Provider}:${MediaType}:${string}`;

export function itemKey(provider: Provider, mediaType: MediaType, providerId: string): ItemKey {
  return `${provider}:${mediaType}:${providerId}`;
}

/**
 * Which of `keys` the user already has in their library: a movie or game
 * entry, or an entry for any season of a show. Pass the user's own client;
 * it can read other users' public libraries too, so every entry query is
 * filtered to `userId`.
 */
export async function inLibrary(supabase: Client, userId: string, keys: ItemKey[]): Promise<Set<ItemKey>> {
  const found = new Set<ItemKey>();
  if (!keys.length) return found;
  const wanted = new Set<string>(keys);

  const { data: items, error } = await supabase
    .from("items")
    .select("id, provider, media_type, provider_id")
    .in("provider_id", [...new Set(keys.map((k) => k.split(":")[2]))]);
  if (error) throw error;
  const known = items
    .map((i) => ({ id: i.id, key: itemKey(i.provider, i.media_type, i.provider_id) }))
    .filter((i) => wanted.has(i.key));
  if (!known.length) return found;
  const keyOf = new Map(known.map((i) => [i.id, i.key]));

  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id, show_id")
    .in("show_id", [...keyOf.keys()]);
  if (seasonsError) throw seasonsError;
  const showOf = new Map(seasons.map((s) => [s.id, s.show_id]));

  const [byItem, bySeason] = await Promise.all([
    supabase.from("library_entries").select("item_id").eq("user_id", userId).in("item_id", [...keyOf.keys()]),
    showOf.size
      ? supabase.from("library_entries").select("season_id").eq("user_id", userId).in("season_id", [...showOf.keys()])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byItem.error) throw byItem.error;
  if (bySeason.error) throw bySeason.error;

  for (const e of byItem.data) found.add(keyOf.get(e.item_id!)!);
  for (const e of bySeason.data as { season_id: string | null }[]) {
    found.add(keyOf.get(showOf.get(e.season_id!)!)!);
  }
  return found;
}

/** Season numbers of a TMDB show that the user already has in their library. */
export async function seasonsInLibrary(supabase: Client, userId: string, tmdbId: string): Promise<Set<number>> {
  const { data, error } = await supabase
    .from("library_entries")
    .select("seasons!inner(season_number, items!inner(provider, media_type, provider_id))")
    .eq("user_id", userId)
    .eq("seasons.items.provider", "tmdb")
    .eq("seasons.items.media_type", "show")
    .eq("seasons.items.provider_id", tmdbId);
  if (error) throw error;
  return new Set(data.map((e) => e.seasons.season_number));
}
