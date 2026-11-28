import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";

type Client = SupabaseClient<Database>;

/** The longest note, in characters (code points, as the table's check counts). */
export const NOTE_MAX = 2000;

/**
 * The user's own notes, by entry id. Notes are only ever readable by their
 * owner (INV-002); the filter on the user keeps this the user's own anyway.
 * Never read for anyone else's library (the public profile doesn't call this).
 */
export async function getMyNotes(supabase: Client, userId: string): Promise<Map<string, string>> {
  const rows = await fetchAll((from, to) =>
    supabase.from("entry_notes").select("entry_id, body").eq("user_id", userId).order("entry_id").range(from, to),
  );
  return new Map(rows.map((r) => [r.entry_id, r.body]));
}

/**
 * Saves the note on one of the user's entries, replacing any note there; an
 * empty body deletes it (one that's already gone is a quiet success). Written
 * as the user: the insert policy needs the entry to be theirs, so a note on
 * anyone else's entry is refused before its key could say whether one exists.
 */
export async function saveEntryNote(supabase: Client, userId: string, entryId: string, body: string): Promise<void> {
  if (!body) {
    const { error } = await supabase.from("entry_notes").delete().eq("entry_id", entryId).eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("entry_notes")
    .upsert({ entry_id: entryId, user_id: userId, body }, { onConflict: "entry_id" });
  if (error?.code === "42501") throw new Error("That entry isn't in your library.", { cause: error });
  if (error) throw error;
}
