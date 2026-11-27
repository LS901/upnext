import { Constants, type Database } from "@/lib/supabase/database.types";

export type EntryStatus = Database["public"]["Enums"]["entry_status"];

/** Every status, in the order a status picker lists them. */
export const ENTRY_STATUSES: readonly EntryStatus[] = Constants.public.Enums.entry_status;

export const STATUS_LABELS: Record<EntryStatus, string> = {
  backlog: "Up next",
  in_progress: "In progress",
  finished: "Finished",
  paused: "Paused",
  dropped: "Dropped",
};

/** The order of the groups on My library, after Up next (which holds every Backlog entry). */
export const LIBRARY_ORDER: readonly EntryStatus[] = ["in_progress", "paused", "finished", "dropped"];

export function isEntryStatus(value: string): value is EntryStatus {
  return (ENTRY_STATUSES as readonly string[]).includes(value);
}
