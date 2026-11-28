"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { text } from "@/app/form-data";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  addEntryToList,
  createList as makeList,
  deleteList as dropList,
  listName,
  removeEntryFromList,
  renameList as nameList,
  setListPrivate as hideList,
} from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every action checks its ids first, then the signed-in user, then writes
// through the user's own client: RLS lets them touch only their own lists and
// entries (INV-001). A bad name goes back to Lists with a message.

function idFrom(formData: FormData, name: "listId" | "entryId"): string {
  const id = text(formData, name);
  if (!UUID.test(id)) throw new Error("Not a list change that can be made.");
  return id;
}

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return { userId: user.id, supabase: await createClient() };
}

export async function createList(formData: FormData) {
  const { supabase } = await signedIn();
  const name = listName(text(formData, "name"));
  if (!name) redirect("/lists?error=name");
  await makeList(supabase, name);
  redirect("/lists");
}

export async function renameList(formData: FormData) {
  const listId = idFrom(formData, "listId");
  const { supabase, userId } = await signedIn();
  const name = listName(text(formData, "name"));
  if (!name) redirect("/lists?error=name");
  await nameList(supabase, userId, listId, name);
  redirect("/lists");
}

/** Sets exactly the value the button names, so a repeat (a double-click, a stale page) changes nothing. */
export async function setListPrivate(formData: FormData) {
  const listId = idFrom(formData, "listId");
  const isPrivate = text(formData, "private") === "true";
  const { supabase, userId } = await signedIn();
  await hideList(supabase, userId, listId, isPrivate);
  refresh();
}

/** Needs the confirm box ticked; the list's library entries stay. */
export async function deleteList(formData: FormData) {
  const listId = idFrom(formData, "listId");
  const { supabase, userId } = await signedIn();
  if (!formData.has("confirm")) redirect("/lists?error=confirm");
  await dropList(supabase, userId, listId);
  redirect("/lists");
}

/** "Add to list" on a My library row: at the end of the list; already on it is a quiet success. */
export async function addToList(formData: FormData) {
  const listId = idFrom(formData, "listId");
  const entryId = idFrom(formData, "entryId");
  const { supabase, userId } = await signedIn();
  await addEntryToList(supabase, userId, listId, entryId);
  refresh();
}

export async function removeFromList(formData: FormData) {
  const listId = idFrom(formData, "listId");
  const entryId = idFrom(formData, "entryId");
  const { supabase, userId } = await signedIn();
  await removeEntryFromList(supabase, userId, listId, entryId);
  refresh();
}
