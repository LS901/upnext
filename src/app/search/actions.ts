"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { importItem, type ImportedItem } from "@/lib/catalogue/import";
import { ProviderError, type MediaType, type Provider } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { parseSearch, searchHref } from "./params";

type NewEntry = Pick<
  Database["public"]["Tables"]["library_entries"]["Insert"],
  "item_id" | "item_media_type" | "season_id"
>;

const PROVIDER_ID = /^\d{1,12}$/;
const SEASON_NUMBER = /^\d{1,4}$/;

// Adds a movie or game to the signed-in user's Backlog. Only the provider and
// its id come from the form: importItem fetches everything else itself.
export async function addItem(formData: FormData) {
  const provider = formData.get("provider");
  const mediaType = formData.get("mediaType");
  const providerId = String(formData.get("providerId") ?? "");
  const valid =
    ((provider === "tmdb" && mediaType === "movie") || (provider === "igdb" && mediaType === "game")) &&
    PROVIDER_ID.test(providerId);
  if (!valid) throw new Error("Not a movie or game that can be added.");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const search = parseSearch({ q: formData.get("q") as string | null, exclude: formData.getAll("exclude") as string[] });
  await addEntries(
    provider,
    mediaType,
    providerId,
    user.id,
    (imported) => [{ item_id: imported.itemId, item_media_type: mediaType }],
    searchHref(search, { failed: provider }),
  );
  redirect(searchHref(search, { added: "1" }));
}

// Adds the chosen seasons of a TMDB show to the signed-in user's Backlog.
export async function addSeasons(formData: FormData) {
  const tmdbId = String(formData.get("tmdbId") ?? "");
  if (!PROVIDER_ID.test(tmdbId)) throw new Error("Not a show that can be added.");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const picker = `/search/show/${tmdbId}`;
  const chosen = new Set(
    formData
      .getAll("season")
      .map(String)
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
      if (err instanceof ProviderError) redirect(failedUrl);
      throw err;
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
