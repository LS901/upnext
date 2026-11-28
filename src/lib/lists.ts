import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seasonName } from "@/app/search/season-label";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import { publicOwnerId } from "@/lib/library/public-library";
import { imageUrl } from "@/lib/library/queries";
import type { EntryStatus } from "@/lib/library/status";
import type { MediaType } from "@/lib/providers/types";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll, fetchAllIn } from "@/lib/supabase/fetch-all";

// Lists group the user's own library entries (ruling Q0-c). Every function takes
// the caller's own client, so row-level security decides what's visible: others
// see a list only while it's public and its owner's library is public (INV-002),
// and only the owner writes (INV-001). Reads of the user's own lists also filter
// on the user, because the client can read other users' public lists too.

type Client = SupabaseClient<Database>;

/** The longest list name, in characters (code points, as the table's check counts). */
export const LIST_NAME_MAX = 80;

/** The trimmed name when it's 1 to 80 characters, else null. */
export function listName(raw: string): string | null {
  const name = raw.trim();
  const length = Array.from(name).length;
  return length >= 1 && length <= LIST_NAME_MAX ? name : null;
}

export type ListSummary = { id: string; name: string; isPrivate: boolean; count: number };

const summaries = (rows: { id: string; name: string; is_private: boolean; list_entries: { count: number }[] }[]) =>
  rows.map((l) => ({ id: l.id, name: l.name, isPrivate: l.is_private, count: l.list_entries[0]?.count ?? 0 }));

/** The user's own lists, oldest first, public and private. */
export async function getMyLists(supabase: Client, userId: string): Promise<ListSummary[]> {
  const rows = await fetchAll((from, to) =>
    supabase
      .from("lists")
      .select("id, name, is_private, list_entries(count)")
      .eq("user_id", userId)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  return summaries(rows);
}

/**
 * A user's public lists, for their profile: none for an unknown username or a
 * private library. Only lists that aren't private, even when the owner looks,
 * since the profile shows what others see.
 */
export async function getPublicLists(supabase: Client, username: string): Promise<ListSummary[]> {
  const ownerId = await publicOwnerId(supabase, username);
  if (!ownerId) return [];
  const rows = await fetchAll((from, to) =>
    supabase
      .from("lists")
      .select("id, name, is_private, list_entries(count)")
      .eq("user_id", ownerId)
      .eq("is_private", false)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  return summaries(rows);
}

/** An entry on a list, as the list page shows it: never a note, never a synopsis. */
export type ListEntryRow = {
  entryId: string;
  /** The title; a season's names its show and season ("Show · Season 2"). */
  title: string;
  /** The title, told apart from the same book's other version when heard. */
  name: string;
  mediaType: MediaType;
  status: EntryStatus;
  imageUrl: string | null;
  /** "Movie", "TV", "Book · Audiobook", "Other". */
  meta: string;
};

export type ListView = {
  id: string;
  name: string;
  isPrivate: boolean;
  ownerId: string;
  ownerUsername: string | null;
  entries: ListEntryRow[];
};

/**
 * One list and its entries in their order, or null when the caller can't see
 * it: no such list, a private list, or a list in a private library all look
 * the same.
 */
export async function getList(supabase: Client, listId: string): Promise<ListView | null> {
  const { data: list, error } = await supabase
    .from("lists")
    .select("id, name, is_private, user_id")
    .eq("id", listId)
    .maybeSingle();
  if (error) throw error;
  if (!list) return null;

  const [owner, rows] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", list.user_id).maybeSingle(),
    fetchAll((from, to) =>
      supabase
        .from("list_entries")
        .select(
          `entry_id,
           entry:library_entries(id, status, book_version,
             item:items(provider, media_type, title, image_ref),
             season:seasons(season_number, show:items(provider, title, image_ref)))`,
        )
        .eq("list_id", listId)
        .order("position")
        .order("created_at")
        .order("entry_id")
        .range(from, to),
    ),
  ]);
  if (owner.error) throw owner.error;

  const entries: ListEntryRow[] = rows.flatMap(({ entry: e }) => {
    if (!e) return [];
    if (e.item) {
      const audio = e.item.media_type === "book" && e.book_version === "audio";
      return [
        {
          entryId: e.id,
          title: e.item.title,
          name: audio ? `${e.item.title} · Audiobook` : e.item.title,
          mediaType: e.item.media_type,
          status: e.status,
          imageUrl: imageUrl(e.item.provider, e.item.image_ref),
          meta: audio ? `${TYPE_LABELS.book} · Audiobook` : TYPE_LABELS[e.item.media_type],
        },
      ];
    }
    if (e.season) {
      const title = `${e.season.show.title} · ${seasonName(e.season.season_number)}`;
      return [
        {
          entryId: e.id,
          title,
          name: title,
          mediaType: "show" as const,
          status: e.status,
          imageUrl: imageUrl(e.season.show.provider, e.season.show.image_ref),
          meta: TYPE_LABELS.show,
        },
      ];
    }
    return [];
  });
  return {
    id: list.id,
    name: list.name,
    isPrivate: list.is_private,
    ownerId: list.user_id,
    ownerUsername: owner.data?.username ?? null,
    entries,
  };
}

/** Which of the user's lists each of their entries is on, by entry id. */
export async function getListMemberships(supabase: Client, listIds: string[]): Promise<Map<string, string[]>> {
  const rows = await fetchAllIn(listIds, (ids, from, to) =>
    supabase.from("list_entries").select("list_id, entry_id").in("list_id", ids).order("list_id").order("entry_id").range(from, to),
  );
  const byEntry = new Map<string, string[]>();
  for (const r of rows) byEntry.set(r.entry_id, [...(byEntry.get(r.entry_id) ?? []), r.list_id]);
  return byEntry;
}

export async function createList(supabase: Client, name: string): Promise<void> {
  const { error } = await supabase.from("lists").insert({ name });
  if (error) throw error;
}

// The writes below filter on the list and the user; another user's list (RLS
// hides it) or one already gone changes nothing, and says nothing either way.

export async function renameList(supabase: Client, userId: string, listId: string, name: string): Promise<void> {
  const { error } = await supabase.from("lists").update({ name }).eq("id", listId).eq("user_id", userId);
  if (error) throw error;
}

export async function setListPrivate(supabase: Client, userId: string, listId: string, isPrivate: boolean): Promise<void> {
  const { error } = await supabase.from("lists").update({ is_private: isPrivate }).eq("id", listId).eq("user_id", userId);
  if (error) throw error;
}

/** Deletes the list and takes its entries off it; the library entries themselves stay. */
export async function deleteList(supabase: Client, userId: string, listId: string): Promise<void> {
  const { error } = await supabase.from("lists").delete().eq("id", listId).eq("user_id", userId);
  if (error) throw error;
}

/**
 * Puts one of the user's entries at the end of one of their lists. Already on
 * it (a double-click, another tab) is a quiet success that changes nothing.
 * Anyone else's list or entry is refused by the database, which throws.
 */
export async function addEntryToList(supabase: Client, userId: string, listId: string, entryId: string): Promise<void> {
  const { data: last, error: lastError } = await supabase
    .from("list_entries")
    .select("position, list:lists!inner(user_id)")
    .eq("list_id", listId)
    .eq("list.user_id", userId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;
  const { error } = await supabase
    .from("list_entries")
    .insert({ list_id: listId, entry_id: entryId, position: (last?.position ?? 0) + 1 });
  if (error?.code === "23505") return; // already on the list: the policy means it's the user's own row
  if (error?.code === "42501") throw new Error("That isn't your list or your entry.", { cause: error });
  if (error) throw error;
}

/** Takes an entry off one of the user's lists; one already off is a quiet success. */
export async function removeEntryFromList(supabase: Client, userId: string, listId: string, entryId: string): Promise<void> {
  // The delete policy needs the list to be the user's; the list's owner is checked here too.
  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("user_id", userId)
    .maybeSingle();
  if (listError) throw listError;
  if (!list) return;
  const { error } = await supabase.from("list_entries").delete().eq("list_id", listId).eq("entry_id", entryId);
  if (error) throw error;
}
