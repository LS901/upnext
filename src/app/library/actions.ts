"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { text, texts } from "@/app/form-data";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteEntry, playEntryAgain, setEntryStatus } from "@/lib/library/queries";
import { isEntryStatus } from "@/lib/library/status";
import { placeInUpNext } from "@/lib/library/up-next";
import { HIDDEN_COOKIE, hiddenFromShown } from "@/lib/library/up-next-order";
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

/** "Watched again" and its kin. `expected` is the count the page showed; a repeat changes nothing. */
export async function playAgain(formData: FormData) {
  const entryId = text(formData, "entryId");
  const expected = Number(text(formData, "expected"));
  if (!UUID.test(entryId) || !Number.isSafeInteger(expected) || expected < 0) {
    throw new Error("Not a play that can be counted.");
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await playEntryAgain(await createClient(), user.id, entryId, expected);
  refresh();
}

// Up next (one queue per media type, holding every Backlog entry; the database
// adds and removes entries as their status changes, so the only Up next write
// here is a reorder). The same rules: valid ids first, then the signed-in user,
// then writes through the user's own client.

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

/**
 * A drag, or a Move up / Move down / Move to top button: `beforeId` is the
 * entry to land just above, or empty for the end. The target is exact, so a
 * repeat (a double-click, a stale page) lands in the same place.
 */
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
    secure: process.env.NODE_ENV === "production",
  });
  // Setting a cookie in an action re-renders the page; no refresh() needed.
}
