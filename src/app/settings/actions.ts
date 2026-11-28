"use server";

import { refresh, revalidatePath } from "next/cache";
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

/**
 * "Keep my library private" (INV-002): while it's ticked nobody else sees the
 * library, its lists or its own entries' titles, through any page or the API.
 * Written as the user, to their own profile only.
 */
export async function setLibraryPrivate(formData: FormData) {
  const isPrivate = formData.has("private");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { error } = await (await createClient()).from("profiles").update({ library_private: isPrivate }).eq("id", user.id);
  if (error) throw error;
  refresh();
}

/**
 * 3 to 30 lowercase letters, numbers and hyphens, starting and ending with a
 * letter or number. Never an email (INV-009), and always safe in a /u/ link.
 */
const USERNAME = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** Changes the user's username, which names their public profile. A taken one is refused with its own message. */
export async function setUsername(formData: FormData) {
  const username = text(formData, "username").trim().toLowerCase();

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!USERNAME.test(username)) redirect("/settings?error=username");

  const { error } = await (await createClient()).from("profiles").update({ username }).eq("id", user.id);
  if (error?.code === "23505") redirect("/settings?error=username-taken");
  if (error) throw error;
  // The header (in the root layout) shows the username on every page, so the layout is re-rendered;
  // the redirect clears any earlier error from the URL.
  revalidatePath("/", "layout");
  redirect("/settings");
}
