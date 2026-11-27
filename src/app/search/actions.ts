"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { importItem, type ImportedItem } from "@/lib/catalogue/import";
import { ProviderError, type MediaType, type Provider } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { text, texts } from "@/app/form-data";
import { parseSearch, searchHref } from "./params";
import type { BookVersion } from "@/lib/library/in-library";
import { logProviderFailure, PROVIDER_ID } from "./shared";

type NewEntry = Pick<
  Database["public"]["Tables"]["library_entries"]["Insert"],
  "item_id" | "item_media_type" | "season_id" | "book_version"
>;

const SEASON_NUMBER = /^\d{1,4}$/;

// Adds a movie, game or book to the signed-in user's Backlog. Only the provider,
// its id and, for a book, the version come from the form: importItem fetches
// everything else itself.
export async function addItem(formData: FormData) {
  const provider = text(formData, "provider");
  const mediaType = text(formData, "mediaType");
  const providerId = text(formData, "providerId");
  const valid =
    ((provider === "tmdb" && mediaType === "movie") ||
      (provider === "igdb" && mediaType === "game") ||
      (provider === "hardcover" && mediaType === "book")) &&
    PROVIDER_ID.test(providerId);
  if (!valid) throw new Error("Not an item that can be added.");
  // A book is added as print or as an audiobook; other types have no version.
  const version = text(formData, "version");
  if (mediaType === "book" && version !== "print" && version !== "audio") {
    throw new Error("A book needs a version: print or audio.");
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const search = parseSearch({ q: text(formData, "q"), exclude: texts(formData, "exclude") });
  await addEntries(
    provider,
    mediaType,
    providerId,
    user.id,
    (imported) => [
      mediaType === "book"
        ? { item_id: imported.itemId, item_media_type: mediaType, book_version: version as BookVersion }
        : { item_id: imported.itemId, item_media_type: mediaType },
    ],
    searchHref(search, { failed: provider }),
  );
  redirect(searchHref(search, { added: "1" }));
}

// Adds the chosen seasons of a TMDB show to the signed-in user's Backlog.
export async function addSeasons(formData: FormData) {
  const tmdbId = text(formData, "tmdbId");
  if (!PROVIDER_ID.test(tmdbId)) throw new Error("Not a show that can be added.");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const picker = `/search/show/${tmdbId}`;
  const chosen = new Set(
    texts(formData, "season")
      .filter((s) => SEASON_NUMBER.test(s))
      .map(Number),
  );
  if (!chosen.size) redirect(picker);

  await addEntries(
    "tmdb",
    "show",
    tmdbId,
    user.id,
    // Numbers the catalogue doesn't hold are ignored.
    (imported) => imported.seasons.filter((s) => chosen.has(s.number)).map((s) => ({ season_id: s.id })),
    `${picker}?failed=tmdb`,
  );
  redirect(`${picker}?added=1`);
}

// Imports the item, then inserts the entries as the user (RLS applies,
// INV-001). A duplicate means it's already in the library, which is success
// (INV-008). If the weekly refresh pruned the item between the import and the
// insert (23503), import it once more and retry once.
async function addEntries(
  provider: Provider,
  mediaType: MediaType,
  providerId: string,
  userId: string,
  entriesFor: (imported: ImportedItem) => NewEntry[],
  failedUrl: string,
): Promise<void> {
  const supabase = await createClient();

  for (let attempt = 1; ; attempt++) {
    let imported: ImportedItem;
    try {
      imported = await importItem(provider, mediaType, providerId);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      logProviderFailure(err);
      redirect(failedUrl);
    }

    let pruned = false;
    for (const entry of entriesFor(imported)) {
      const { error } = await supabase
        .from("library_entries")
        .insert({ ...entry, user_id: userId, status: "backlog" });
      if (!error || error.code === "23505") continue;
      if (error.code === "23503") {
        pruned = true;
        break;
      }
      throw new Error(`Couldn't add to the library: ${error.message}`, { cause: error });
    }
    if (!pruned) return;
    if (attempt === 2) throw new Error("The catalogue item was removed while it was being added.");
  }
}
