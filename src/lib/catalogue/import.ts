import "server-only";
import { getDetails } from "@/lib/providers";
import type { MediaType, Provider, SeasonDetails } from "@/lib/providers/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type ItemRow = Database["public"]["Tables"]["items"]["Insert"];
type SeasonRow = Database["public"]["Tables"]["seasons"]["Insert"];

export type ImportedItem = {
  itemId: string;
  seasons: { id: string; number: number }[];
};

/**
 * Fetches an item from its provider and writes it to the catalogue. The only
 * writer of `items` and `seasons`. It upserts, never deletes (a season the
 * provider drops is kept), and never touches user tables (INV-003). Fields a
 * failed sub-request couldn't fetch keep their stored value.
 */
export async function importItem(
  provider: Provider,
  mediaType: MediaType,
  providerId: string,
): Promise<ImportedItem> {
  const details = await getDetails(provider, mediaType, providerId);
  const admin = createAdminClient();

  const item: ItemRow = {
    provider: details.provider,
    media_type: details.mediaType,
    provider_id: details.providerId,
    title: details.title,
    image_ref: details.imageRef,
    release_date: details.releaseDate,
    runtime_minutes: details.runtimeMinutes,
    score: details.score,
    score_count: details.scoreCount,
    refreshed_at: new Date().toISOString(),
    provider_data_purged_at: null,
  };
  if (!details.timeToBeatUnavailable) {
    item.ttb_hastily_s = details.timeToBeat?.hastilyS ?? null;
    item.ttb_normally_s = details.timeToBeat?.normallyS ?? null;
    item.ttb_completely_s = details.timeToBeat?.completelyS ?? null;
    item.ttb_count = details.timeToBeat?.count ?? null;
  }

  const { data: saved, error } = await admin
    .from("items")
    .upsert(item, { onConflict: "provider,media_type,provider_id" })
    .select("id")
    .single();
  if (error) throw error;

  const seasons = await upsertSeasons(admin, saved.id, details.seasons ?? []);
  return { itemId: saved.id, seasons };
}

async function upsertSeasons(
  admin: ReturnType<typeof createAdminClient>,
  showId: string,
  seasons: SeasonDetails[],
): Promise<ImportedItem["seasons"]> {
  const row = (s: SeasonDetails): SeasonRow => ({
    show_id: showId,
    season_number: s.number,
    title: s.title,
    episode_count: s.episodeCount,
    air_date: s.airDate,
  });
  // A season whose runtime couldn't be fetched leaves runtime_minutes out of
  // the upsert, so a known runtime survives (a new season inserts null).
  const groups = [
    seasons.filter((s) => !s.runtimeUnavailable).map((s) => ({ ...row(s), runtime_minutes: s.runtimeMinutes })),
    seasons.filter((s) => s.runtimeUnavailable).map(row),
  ];

  const out: ImportedItem["seasons"] = [];
  for (const rows of groups) {
    if (!rows.length) continue;
    const { data, error } = await admin
      .from("seasons")
      .upsert(rows, { onConflict: "show_id,season_number" })
      .select("id, season_number");
    if (error) throw error;
    for (const s of data) out.push({ id: s.id, number: s.season_number });
  }
  return out.sort((a, b) => a.number - b.number);
}
