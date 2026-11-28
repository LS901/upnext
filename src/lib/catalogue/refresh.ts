import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { importItem } from "./import";

const DAY_MS = 24 * 60 * 60 * 1000;
/** TMDB allows caching for 6 months; purge well before that (INV-007). */
const PURGE_AFTER_DAYS = 150;
/** Items nobody tracks are deleted this long after they were imported. */
const PRUNE_AFTER_DAYS = 30;
const BATCH = 100;

type Admin = ReturnType<typeof createAdminClient>;

export type RefreshResult = {
  refreshed: number;
  failed: number;
  purged: number;
  pruned: number;
};

const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

/** A Postgres error's code (such as 22007), else the error's name (such as ProviderError). */
function errorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const { code, name } = err as { code?: unknown; name?: unknown };
    if (typeof code === "string" && code) return code;
    if (typeof name === "string" && name) return name;
  }
  return "unknown";
}

/**
 * Re-imports the items not refreshed for `olderThanDays`, one at a time (the
 * provider clients keep within their rate limits). Every attempt is stamped
 * in refresh_attempted_at, and items not attempted within the same window go
 * first, so an item that keeps failing upstream can't block the queue. Any
 * failure of one item (a provider error, a database error, bad data) counts
 * as failed and the pass moves on, so one bad item never stops the run. Then
 * it always purges provider data that has gone too long without a refresh,
 * and prunes untracked items. Never writes or deletes user data (INV-003).
 */
export async function refreshStaleItems(
  opts: { olderThanDays?: number; limit?: number } = {},
): Promise<RefreshResult> {
  const { olderThanDays = 7, limit = 50 } = opts;
  const admin = createAdminClient();

  const cutoff = daysAgo(olderThanDays);
  const { data: stale, error } = await admin
    .from("items")
    .select("id, provider, media_type, provider_id")
    .neq("provider", "manual") // a user's own entry has no provider to ask
    .lt("refreshed_at", cutoff)
    .or(`refresh_attempted_at.is.null,refresh_attempted_at.lt."${cutoff}"`)
    .order("refresh_attempted_at", { ascending: true, nullsFirst: true })
    .order("refreshed_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  let refreshed = 0;
  let failed = 0;
  for (const item of stale) {
    try {
      // Stamped before the attempt, so a failure of any kind still counts.
      const attempt = await admin
        .from("items")
        .update({ refresh_attempted_at: new Date().toISOString() })
        .eq("id", item.id);
      if (attempt.error) throw attempt.error;
      await importItem(item.provider, item.media_type, item.provider_id);
      refreshed++;
    } catch (err) {
      failed++;
      // The item id and the error's code or name only: never a provider
      // payload or a message that could quote one (INV-005, INV-006).
      console.error(`Refresh failed for item ${item.id} (${errorCode(err)})`);
    }
  }

  const purged = await purgeStaleProviderData(admin);
  const pruned = await pruneUntrackedItems(admin);
  return { refreshed, failed, purged, pruned };
}

/**
 * Nulls the provider fields of items whose last successful refresh is older
 * than PURGE_AFTER_DAYS, keeping the title and season numbers so a library
 * entry still has a name. Seasons first, so an interrupted run is redone.
 */
async function purgeStaleProviderData(admin: Admin): Promise<number> {
  const cutoff = daysAgo(PURGE_AFTER_DAYS);
  let purged = 0;
  for (;;) {
    const { data: batch, error } = await admin
      .from("items")
      .select("id")
      .neq("provider", "manual")
      .lt("refreshed_at", cutoff)
      .is("provider_data_purged_at", null)
      .limit(BATCH);
    if (error) throw error;
    if (!batch.length) return purged;
    const ids = batch.map((r) => r.id);

    const seasons = await admin
      .from("seasons")
      .update({ episode_count: null, runtime_minutes: null, air_date: null })
      .in("show_id", ids);
    if (seasons.error) throw seasons.error;

    const { data: done, error: itemsError } = await admin
      .from("items")
      .update({
        image_ref: null,
        release_date: null,
        runtime_minutes: null,
        score: null,
        score_count: null,
        ttb_hastily_s: null,
        ttb_normally_s: null,
        ttb_completely_s: null,
        ttb_count: null,
        page_count: null,
        audio_minutes: null,
        has_audiobook: null,
        narrators: null,
        genres: [],
        provider_data_purged_at: new Date().toISOString(),
      })
      .in("id", ids)
      .lt("refreshed_at", cutoff)
      .is("provider_data_purged_at", null)
      .select("id");
    if (itemsError) throw itemsError;
    if (!done.length) return purged; // refreshed meanwhile; avoid looping
    purged += done.length;
  }
}

/**
 * Deletes items imported more than PRUNE_AFTER_DAYS ago that nobody tracks:
 * no library entry on the item or any of its seasons, and no progress
 * exclusion on its seasons. A manual item with an entry counts as tracked, so
 * it stays like any other. The seasons go with the item (cascade). If someone
 * starts tracking it meanwhile, the restrict foreign keys refuse the delete
 * (23503) and it is skipped.
 */
async function pruneUntrackedItems(admin: Admin): Promise<number> {
  const cutoff = daysAgo(PRUNE_AFTER_DAYS);
  const candidates: string[] = [];
  for (let from = 0; ; from += BATCH) {
    // Items with a direct entry (movies, games) are filtered out by the database.
    const { data, error } = await admin
      .from("items")
      .select("id, library_entries(id), seasons(library_entries(id), progress_exclusions(season_id))")
      .lt("created_at", cutoff)
      .is("library_entries", null)
      .order("id")
      .range(from, from + BATCH - 1);
    if (error) throw error;
    for (const item of data) {
      const tracked = item.seasons.some((s) => s.library_entries.length || s.progress_exclusions.length);
      if (!tracked) candidates.push(item.id);
    }
    if (data.length < BATCH) break;
  }

  let pruned = 0;
  for (const id of candidates) {
    const { data, error } = await admin
      .from("items")
      .delete()
      .eq("id", id)
      .lt("created_at", cutoff)
      .select("id");
    if (error?.code === "23503") continue; // tracked since the check
    if (error) throw error;
    pruned += data.length;
  }
  return pruned;
}
