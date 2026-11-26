import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { placeBefore, queueOf, targetFor, type Direction, type Placed, type QueueType } from "./up-next-order";

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
  // Not the user's (RLS hid it), or it left Backlog meanwhile.
  if (!data.length) throw new Error(NOT_YOURS);
}

async function write(supabase: Client, userId: string, placed: Placed[]): Promise<void> {
  await Promise.all(placed.map((p) => setPosition(supabase, userId, p.id, p.position)));
}

/** Adds a Backlog entry to the bottom of its type's queue. Already queued: nothing changes. */
export async function addToUpNext(supabase: Client, userId: string, entryId: string): Promise<void> {
  const entry = await ownEntry(supabase, userId, entryId);
  if (entry.up_next_position !== null) return;
  if (entry.status !== "backlog") throw new Error("Only Backlog entries can go in Up next.");
  const queue = await loadQueue(supabase, userId, queueOf(entry));
  await write(supabase, userId, placeBefore(queue, entry.id, null));
}

/** Takes an entry off its queue; it stays in Backlog. Not queued (a double-click): nothing changes. */
export async function removeFromUpNext(supabase: Client, userId: string, entryId: string): Promise<void> {
  const entry = await ownEntry(supabase, userId, entryId);
  if (entry.up_next_position === null) return;
  await setPosition(supabase, userId, entry.id, null);
}

/** The Move up / Move down / Move to top buttons. A move past either end, or of an entry no longer queued, does nothing. */
export async function moveInUpNext(supabase: Client, userId: string, entryId: string, direction: Direction): Promise<void> {
  const entry = await ownEntry(supabase, userId, entryId);
  if (entry.up_next_position === null) return;
  const queue = await loadQueue(supabase, userId, queueOf(entry));
  const target = targetFor(queue, entry.id, direction);
  if (target) await write(supabase, userId, placeBefore(queue, entry.id, target.beforeId));
}

/**
 * A drag: puts the entry just before `beforeId` (`null`: at the end). `beforeId`
 * must be in the same queue, so an entry can never land in another type's
 * queue; when it isn't (another type, or a stale page), nothing moves.
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
  await write(supabase, userId, placeBefore(queue, entry.id, beforeId));
}
