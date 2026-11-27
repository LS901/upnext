import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { placeBefore, queueOf, type Placed, type Placement, type QueueType } from "./up-next-order";

// Up next writes, through the user's own client. Every read is filtered to the
// user (their client can read other users' public entries too) and every write
// to the user and to Backlog, so RLS and the schema check both back it up
// (INV-001, INV-002). Pass the signed-in user's id.

type Client = SupabaseClient<Database>;

const NOT_YOURS = "That entry isn't in your library.";

async function ownEntry(supabase: Client, userId: string, entryId: string) {
  const { data, error } = await supabase
    .from("library_entries")
    .select("id, status, item_media_type, season_id, up_next_position")
    .eq("id", entryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(NOT_YOURS);
  return data;
}

/** The user's queue for one media type, in order. */
async function loadQueue(supabase: Client, userId: string, type: QueueType): Promise<Placed[]> {
  const rows = await fetchAll((from, to) => {
    const queued = supabase
      .from("library_entries")
      .select("id, up_next_position")
      .eq("user_id", userId)
      .not("up_next_position", "is", null);
    const ofType = type === "show" ? queued.not("season_id", "is", null) : queued.eq("item_media_type", type);
    return ofType.order("up_next_position").order("id").range(from, to);
  });
  return rows.map((r) => ({ id: r.id, position: r.up_next_position! }));
}

async function setPosition(supabase: Client, userId: string, entryId: string, position: number | null): Promise<void> {
  const { data, error } = await supabase
    .from("library_entries")
    .update({ up_next_position: position })
    .eq("id", entryId)
    .eq("user_id", userId)
    .eq("status", "backlog")
    .select("id");
  if (error) throw error;
  if (data.length) return;
  // Nothing changed. If it left Backlog meanwhile (Start in another tab) there's
  // nothing to do; otherwise RLS refused the write, because it isn't the user's.
  const entry = await ownEntry(supabase, userId, entryId);
  if (entry.status === "backlog") throw new Error(NOT_YOURS);
}

async function apply(supabase: Client, userId: string, placement: Placement | null): Promise<void> {
  if (!placement) return;
  if (placement.kind === "one") return setPosition(supabase, userId, placement.id, placement.position);
  // A renumber is one statement in the database, so it happens in full or not at all.
  const { error } = await supabase.rpc("set_up_next_order", { entry_ids: placement.order });
  if (error) throw error;
}

/** Adds a Backlog entry to the bottom of its type's queue. Already queued: nothing changes. */
export async function addToUpNext(supabase: Client, userId: string, entryId: string): Promise<void> {
  const entry = await ownEntry(supabase, userId, entryId);
  if (entry.up_next_position !== null) return;
  if (entry.status !== "backlog") throw new Error("Only Backlog entries can go in Up next.");
  const queue = await loadQueue(supabase, userId, queueOf(entry));
  await apply(supabase, userId, placeBefore(queue, entry.id, null));
}

/** Takes an entry off its queue; it stays in Backlog. Not queued (a double-click): nothing changes. */
export async function removeFromUpNext(supabase: Client, userId: string, entryId: string): Promise<void> {
  const entry = await ownEntry(supabase, userId, entryId);
  if (entry.up_next_position === null) return;
  await setPosition(supabase, userId, entry.id, null);
}

/**
 * Puts a queued entry just before `beforeId` (`null`: at the end): the Move
 * buttons and a drag both send this exact target, so a repeat (a double-click,
 * a stale page) finds the entry already there and changes nothing. `beforeId`
 * must be in the same queue, so an entry can never land in another type's
 * queue; when it isn't (another type, or gone), nothing moves.
 */
export async function placeInUpNext(
  supabase: Client,
  userId: string,
  entryId: string,
  beforeId: string | null,
): Promise<void> {
  const entry = await ownEntry(supabase, userId, entryId);
  if (entry.up_next_position === null) return;
  const queue = await loadQueue(supabase, userId, queueOf(entry));
  if (beforeId !== null && !queue.some((p) => p.id === beforeId)) return;
  await apply(supabase, userId, placeBefore(queue, entry.id, beforeId));
}
