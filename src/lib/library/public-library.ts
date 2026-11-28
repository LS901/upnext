import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getMyLibrary, type LibraryView } from "./queries";

type Client = SupabaseClient<Database>;

/**
 * The id behind a username, only while that user's library is public; null for
 * an unknown username or a private library alike, so a caller can never tell
 * the two apart (INV-002). The owner gets null for their own private library
 * too: a profile shows what others see.
 */
export async function publicOwnerId(supabase: Client, username: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .eq("library_private", false)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Another user's library, read-only, grouped as on My library: null for an
 * unknown username or a private library. It reads only what row-level
 * security already shows anyone (the entries and the catalogue), and never
 * the owner's notes or exclusions; every entry query is filtered to the owner.
 */
export async function getPublicLibrary(supabase: Client, username: string): Promise<LibraryView | null> {
  const ownerId = await publicOwnerId(supabase, username);
  if (!ownerId) return null;
  return getMyLibrary(supabase, ownerId, { exclusions: false });
}
