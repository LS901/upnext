import "server-only";
import { getDetails } from "@/lib/providers";
import type { BookDetails, MediaType, Provider, SeasonDetails } from "@/lib/providers/types";
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
  const now = new Date().toISOString();

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
    // The refresh re-imports through here too, so it fills (and keeps current) genres.
    genres: details.genres,
    refreshed_at: now,
    refresh_attempted_at: now,
    provider_data_purged_at: null,
  };
  if (details.book) {
    const { book } = details;
    item.page_count = book.pageCount;
    item.audio_minutes = book.audioMinutes;
    item.has_audiobook = book.hasAudiobook;
    item.narrators = book.narrators.length ? book.narrators.join(", ") : null;
    // A book with no series clears any earlier link.
    item.series_id = book.series ? await upsertSeries(admin, book.series) : null;
    item.series_position = book.series?.position ?? null;
    item.series_position_label = book.series?.positionLabel ?? null;
  }
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

  if (details.seasons === null) return { itemId: saved.id, seasons: [] };
  await upsertSeasons(admin, saved.id, details.seasons);

  // Every season the catalogue holds, including ones the provider has dropped
  // since (they are kept because a user may track them).
  const { data: seasons, error: seasonsError } = await admin
    .from("seasons")
    .select("id, season_number")
    .eq("show_id", saved.id)
    .order("season_number");
  if (seasonsError) throw seasonsError;
  return { itemId: saved.id, seasons: seasons.map((s) => ({ id: s.id, number: s.season_number })) };
}

async function upsertSeries(
  admin: ReturnType<typeof createAdminClient>,
  series: NonNullable<BookDetails["series"]>,
): Promise<string> {
  const { data, error } = await admin
    .from("book_series")
    .upsert(
      {
        provider: "hardcover",
        provider_id: series.providerId,
        name: series.name,
        primary_books_count: series.primaryBooksCount,
        is_completed: series.isCompleted,
      },
      { onConflict: "provider,provider_id" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function upsertSeasons(
  admin: ReturnType<typeof createAdminClient>,
  showId: string,
  seasons: SeasonDetails[],
): Promise<void> {
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

  for (const rows of groups) {
    if (!rows.length) continue;
    const { error } = await admin.from("seasons").upsert(rows, { onConflict: "show_id,season_number" });
    if (error) throw error;
  }
}
