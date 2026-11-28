// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as lists from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";
import { addToList, createList, deleteList, removeFromList, renameList, setListPrivate } from "./actions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/lists", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/lists")>();
  return {
    ...real,
    createList: vi.fn(),
    renameList: vi.fn(),
    setListPrivate: vi.fn(),
    deleteList: vi.fn(),
    addEntryToList: vi.fn(),
    removeEntryFromList: vi.fn(),
  };
});

const USER = { id: "user-1", username: "user-abcd1234" };
const LIST = "0b5d6c1e-3f7a-4d2b-9c8e-1a2b3c4d5e6f";
const ENTRY = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const client = { from: vi.fn() };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(createClient).mockResolvedValue(client as never);
  vi.mocked(refresh).mockClear();
  vi.mocked(redirect).mockClear();
  for (const fn of [
    lists.createList,
    lists.renameList,
    lists.setListPrivate,
    lists.deleteList,
    lists.addEntryToList,
    lists.removeEntryFromList,
  ]) {
    vi.mocked(fn).mockReset().mockResolvedValue(undefined as never);
  }
});

test("createList makes a list with the trimmed name, as the user, and goes back to Lists", async () => {
  await expect(createList(form({ name: "  Invented Halloween 2026  " }))).rejects.toThrow("redirect:/lists");
  expect(lists.createList).toHaveBeenCalledExactlyOnceWith(client, "Invented Halloween 2026");
});

test("a name of exactly 80 characters is fine, emoji counted as one", async () => {
  await expect(createList(form({ name: "🎃".repeat(80) }))).rejects.toThrow("redirect:/lists");
  expect(lists.createList).toHaveBeenCalledOnce();
});

test.each([
  ["an empty name", ""],
  ["a blank name", "   "],
  ["an 81-character name", "x".repeat(81)],
  ["a 200-character name", "x".repeat(200)],
])("createList refuses %s with a message and writes nothing", async (_name, name) => {
  await expect(createList(form({ name }))).rejects.toThrow("redirect:/lists?error=name");
  expect(lists.createList).not.toHaveBeenCalled();
});

test("renameList renames the user's list, and refuses a bad name", async () => {
  await expect(renameList(form({ listId: LIST, name: " New name " }))).rejects.toThrow("redirect:/lists");
  expect(lists.renameList).toHaveBeenCalledExactlyOnceWith(client, USER.id, LIST, "New name");
  await expect(renameList(form({ listId: LIST, name: "x".repeat(81) }))).rejects.toThrow("redirect:/lists?error=name");
  expect(lists.renameList).toHaveBeenCalledOnce();
});

test("setListPrivate sets exactly the value sent, so a repeat changes nothing", async () => {
  await setListPrivate(form({ listId: LIST, private: "true" }));
  await setListPrivate(form({ listId: LIST, private: "false" }));
  expect(vi.mocked(lists.setListPrivate).mock.calls).toEqual([
    [client, USER.id, LIST, true],
    [client, USER.id, LIST, false],
  ]);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("deleteList needs the confirm box ticked", async () => {
  await expect(deleteList(form({ listId: LIST }))).rejects.toThrow("redirect:/lists?error=confirm");
  expect(lists.deleteList).not.toHaveBeenCalled();
  await expect(deleteList(form({ listId: LIST, confirm: "on" }))).rejects.toThrow("redirect:/lists");
  expect(lists.deleteList).toHaveBeenCalledExactlyOnceWith(client, USER.id, LIST);
});

test("addToList and removeFromList act as the user, then refresh", async () => {
  await addToList(form({ listId: LIST, entryId: ENTRY }));
  expect(lists.addEntryToList).toHaveBeenCalledExactlyOnceWith(client, USER.id, LIST, ENTRY);
  await removeFromList(form({ listId: LIST, entryId: ENTRY }));
  expect(lists.removeEntryFromList).toHaveBeenCalledExactlyOnceWith(client, USER.id, LIST, ENTRY);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("ids that aren't valid are refused before anything is written", async () => {
  await expect(addToList(form({ listId: "nope", entryId: ENTRY }))).rejects.toThrow();
  await expect(addToList(form({ listId: LIST, entryId: "nope" }))).rejects.toThrow();
  await expect(removeFromList(form({ listId: LIST, entryId: "' or 1=1" }))).rejects.toThrow();
  await expect(renameList(form({ listId: "x", name: "Fine" }))).rejects.toThrow();
  await expect(setListPrivate(form({ listId: "x", private: "true" }))).rejects.toThrow();
  await expect(deleteList(form({ listId: "x", confirm: "on" }))).rejects.toThrow();
  expect(lists.addEntryToList).not.toHaveBeenCalled();
  expect(lists.removeEntryFromList).not.toHaveBeenCalled();
  expect(lists.renameList).not.toHaveBeenCalled();
  expect(lists.setListPrivate).not.toHaveBeenCalled();
  expect(lists.deleteList).not.toHaveBeenCalled();
});

test("signed-out callers are sent to sign in and nothing is written", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(createList(form({ name: "Fine" }))).rejects.toThrow("redirect:/login");
  await expect(addToList(form({ listId: LIST, entryId: ENTRY }))).rejects.toThrow("redirect:/login");
  await expect(deleteList(form({ listId: LIST, confirm: "on" }))).rejects.toThrow("redirect:/login");
  expect(lists.createList).not.toHaveBeenCalled();
  expect(lists.addEntryToList).not.toHaveBeenCalled();
  expect(lists.deleteList).not.toHaveBeenCalled();
});
