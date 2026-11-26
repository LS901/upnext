"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { text, texts } from "@/app/form-data";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteEntry, setEntryStatus } from "@/lib/library/queries";
import { isEntryStatus } from "@/lib/library/status";
import { addToUpNext, moveInUpNext, placeInUpNext, removeFromUpNext } from "@/lib/library/up-next";
import { HIDDEN_COOKIE, hiddenFromShown, type Direction } from "@/lib/library/up-next-order";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Both write as the user: RLS lets them touch only their own entries
// (INV-001). A status change to an entry they don't own changes nothing,
// which throws; a remove of one that's gone (or not theirs) is a no-op.

export async function setStatus(formData: FormData) {
  const entryId = text(formData, "entryId");
  const status = text(formData, "status");
  if (!UUID.test(entryId) || !isEntryStatus(status)) throw new Error("Not a status change that can be made.");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await setEntryStatus(await createClient(), user.id, entryId, status);
  refresh();
}

export async function removeEntry(formData: FormData) {
  const entryId = text(formData, "entryId");
  if (!UUID.test(entryId)) throw new Error("Not an entry that can be removed.");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await deleteEntry(await createClient(), user.id, entryId);
  refresh();
}

// Up next (one queue per media type). The same rules: valid ids first, then
// the signed-in user, then writes through the user's own client.

const DIRECTIONS: readonly string[] = ["up", "down", "top"] satisfies Direction[];
const NOT_UP_NEXT = "Not an Up next change that can be made.";

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return { userId: user.id, supabase: await createClient() };
}

function entryIdFrom(formData: FormData): string {
  const entryId = text(formData, "entryId");
  if (!UUID.test(entryId)) throw new Error(NOT_UP_NEXT);
  return entryId;
}

export async function addUpNext(formData: FormData) {
  const entryId = entryIdFrom(formData);
  const { supabase, userId } = await signedIn();
  await addToUpNext(supabase, userId, entryId);
  refresh();
}

export async function removeUpNext(formData: FormData) {
  const entryId = entryIdFrom(formData);
  const { supabase, userId } = await signedIn();
  await removeFromUpNext(supabase, userId, entryId);
  refresh();
}

/** The Move up / Move down / Move to top buttons. */
export async function moveUpNext(formData: FormData) {
  const entryId = entryIdFrom(formData);
  const direction = text(formData, "direction");
  if (!DIRECTIONS.includes(direction)) throw new Error(NOT_UP_NEXT);
  const { supabase, userId } = await signedIn();
  await moveInUpNext(supabase, userId, entryId, direction as Direction);
  refresh();
}

/** A drag: `beforeId` is the entry it was dropped above, or empty for the end. */
export async function placeUpNext(formData: FormData) {
  const entryId = entryIdFrom(formData);
  const before = text(formData, "beforeId");
  if (before !== "" && !UUID.test(before)) throw new Error(NOT_UP_NEXT);
  const { supabase, userId } = await signedIn();
  await placeInUpNext(supabase, userId, entryId, before || null);
  refresh();
}

/** The "Show" checkboxes above the queues, remembered on this device for a year. */
export async function setUpNextVisibility(formData: FormData) {
  (await cookies()).set(HIDDEN_COOKIE, hiddenFromShown(texts(formData, "show")), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  refresh();
}
