"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { text } from "@/app/form-data";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteEntry, setEntryStatus } from "@/lib/library/queries";
import { isEntryStatus } from "@/lib/library/status";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Both write as the user: RLS lets them touch only their own entries
// (INV-001), and an entry they don't own changes nothing, which throws.

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
