import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

type Ops = {
  /** Which of `candidates` the user has excluded now. */
  current: (candidates: string[]) => Promise<string[]>;
  remove: (ids: string[]) => Promise<void>;
  add: (ids: string[]) => Promise<void>;
};

/**
 * Makes the user's exclusions among `candidates` exactly the ones not in
 * `counted`: removes the excluded rows that are now counted, adds the missing
 * ones (a duplicate counts as success, so a repeat or a double-click changes
 * nothing). Rows outside `candidates` are never touched.
 */
async function syncExclusions(ops: Ops, candidates: string[], counted: Set<string>): Promise<void> {
  if (!candidates.length) return;
  const wanted = new Set(candidates.filter((id) => !counted.has(id)));
  const have = new Set(await ops.current(candidates));
  const toRemove = [...have].filter((id) => !wanted.has(id));
  if (toRemove.length) await ops.remove(toRemove);
  const toAdd = [...wanted].filter((id) => !have.has(id));
  if (toAdd.length) await ops.add(toAdd);
}

function seasonOps(supabase: Client, userId: string): Ops {
  return {
    current: async (ids) => {
      const { data, error } = await supabase
        .from("progress_exclusions")
        .select("season_id")
        .eq("user_id", userId)
        .in("season_id", ids);
      if (error) throw error;
      return data.map((r) => r.season_id);
    },
    remove: async (ids) => {
      const { error } = await supabase.from("progress_exclusions").delete().eq("user_id", userId).in("season_id", ids);
      if (error) throw error;
    },
    add: async (ids) => {
      const { error } = await supabase
        .from("progress_exclusions")
        .upsert(ids.map((season_id) => ({ user_id: userId, season_id })), {
          onConflict: "user_id,season_id",
          ignoreDuplicates: true,
        });
      if (error) throw error;
    },
  };
}

function bookOps(supabase: Client, userId: string): Ops {
  return {
    current: async (ids) => {
      const { data, error } = await supabase
        .from("book_exclusions")
        .select("item_id")
        .eq("user_id", userId)
        .in("item_id", ids);
      if (error) throw error;
      return data.map((r) => r.item_id);
    },
    remove: async (ids) => {
      const { error } = await supabase.from("book_exclusions").delete().eq("user_id", userId).in("item_id", ids);
      if (error) throw error;
    },
    add: async (ids) => {
      const { error } = await supabase
        .from("book_exclusions")
        .upsert(ids.map((item_id) => ({ user_id: userId, item_id })), {
          onConflict: "user_id,item_id",
          ignoreDuplicates: true,
        });
      if (error) throw error;
    },
  };
}

/**
 * Sets which of a show's seasons count toward its progress: the user's
 * exclusions for the show become exactly the seasons not in `counted`. Only the
 * show's own seasons numbered 1 or more are considered (specials never count,
 * and an id from another show is ignored). Writes as the user, so RLS stops
 * anyone writing another user's rows (INV-001).
 */
export async function setSeasonExclusions(
  supabase: Client,
  userId: string,
  showId: string,
  counted: string[],
): Promise<void> {
  const { data, error } = await supabase.from("seasons").select("id").eq("show_id", showId).gte("season_number", 1);
  if (error) throw error;
  await syncExclusions(seasonOps(supabase, userId), data.map((s) => s.id), new Set(counted));
}

/**
 * Sets which of a series' books count toward its progress: the user's
 * exclusions for the series become exactly the main-line books (whole-number
 * positions, the only ones that count) not in `counted`.
 */
export async function setBookExclusions(
  supabase: Client,
  userId: string,
  seriesId: string,
  counted: string[],
): Promise<void> {
  const { data, error } = await supabase
    .from("items")
    .select("id, series_position")
    .eq("series_id", seriesId)
    .eq("media_type", "book");
  if (error) throw error;
  const mainLine = data.filter((b) => b.series_position !== null && Number.isInteger(b.series_position));
  await syncExclusions(bookOps(supabase, userId), mainLine.map((b) => b.id), new Set(counted));
}
