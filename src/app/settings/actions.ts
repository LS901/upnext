"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { text } from "@/app/form-data";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isRecType, knownGenres, type RecType } from "@/lib/recommendations/genres";
import { getGenreEntries } from "@/lib/recommendations/library";
import { genreOptions } from "@/lib/recommendations/suggest";
import { createClient } from "@/lib/supabase/server";

/** The longest genre a pin holds, in characters (the table's check). */
const GENRE_MAX = 60;

function readPin(formData: FormData): { mediaType: RecType; genre: string } {
  const mediaType = text(formData, "mediaType");
  const genre = text(formData, "genre").trim();
  const length = Array.from(genre).length;
  if (!isRecType(mediaType) || length < 1 || length > GENRE_MAX) throw new Error("Not a genre that can be pinned.");
  return { mediaType, genre };
}

// Both write as the user: RLS lets them touch only their own pins (INV-001).

/**
 * Pins a genre. Only a genre the page offers can be pinned (the provider's list
 * or one of the user's own items' genres), so a pin's text is always a
 * provider's genre name, never the user's own words, when it reaches a
 * provider (INV-006). Pinning one twice is a quiet success.
 */
export async function pinGenre(formData: FormData) {
  const { mediaType, genre } = readPin(formData);

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const options = await genreOptions(mediaType, knownGenres(await getGenreEntries(supabase, user.id), mediaType));
  if (!options.includes(genre)) throw new Error("Not a genre that can be pinned.");

  const { error } = await supabase.from("user_genre_pins").insert({ media_type: mediaType, genre });
  if (error && error.code !== "23505") throw error;
  refresh();
}

/** Removes a pin; one already gone (a double-click, another tab) is a quiet success. */
export async function unpinGenre(formData: FormData) {
  const { mediaType, genre } = readPin(formData);

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { error } = await (await createClient())
    .from("user_genre_pins")
    .delete()
    .eq("user_id", user.id)
    .eq("media_type", mediaType)
    .eq("genre", genre);
  if (error) throw error;
  refresh();
}
