// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteEntry, setEntryStatus } from "@/lib/library/queries";
import { addToUpNext, moveInUpNext, placeInUpNext, removeFromUpNext } from "@/lib/library/up-next";
import { createClient } from "@/lib/supabase/server";
import { addUpNext, moveUpNext, placeUpNext, removeEntry, removeUpNext, setStatus, setUpNextVisibility } from "./actions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/library/queries", () => ({ setEntryStatus: vi.fn(), deleteEntry: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/library/up-next", () => ({
  addToUpNext: vi.fn(),
  removeFromUpNext: vi.fn(),
  moveInUpNext: vi.fn(),
  placeInUpNext: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const USER = { id: "user-1", username: "user-abcd1234" };
const ENTRY = "0b5d6c1e-3f7a-4d2b-9c8e-1a2b3c4d5e6f";
const OTHER = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const client = { from: vi.fn() };
const cookieStore = { set: vi.fn() };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(setEntryStatus).mockReset().mockResolvedValue();
  vi.mocked(deleteEntry).mockReset().mockResolvedValue();
  vi.mocked(refresh).mockClear();
  vi.mocked(createClient).mockResolvedValue(client as never);
  for (const fn of [addToUpNext, removeFromUpNext, moveInUpNext, placeInUpNext]) vi.mocked(fn).mockReset();
  cookieStore.set.mockReset();
  vi.mocked(cookies).mockResolvedValue(cookieStore as never);
});

test("setStatus changes the entry as the signed-in user, then refreshes the page", async () => {
  await setStatus(form({ entryId: ENTRY, status: "in_progress" }));
  expect(setEntryStatus).toHaveBeenCalledExactlyOnceWith(client, USER.id, ENTRY, "in_progress");
  expect(refresh).toHaveBeenCalledOnce();
});

test("removeEntry deletes the entry as the signed-in user, then refreshes the page", async () => {
  await removeEntry(form({ entryId: ENTRY }));
  expect(deleteEntry).toHaveBeenCalledExactlyOnceWith(client, USER.id, ENTRY);
  expect(refresh).toHaveBeenCalledOnce();
});

test("a status or entry id that isn't valid is refused before anything is written", async () => {
  await expect(setStatus(form({ entryId: ENTRY, status: "up_next" }))).rejects.toThrow("Not a status change");
  await expect(setStatus(form({ entryId: "1; drop table", status: "finished" }))).rejects.toThrow(
    "Not a status change",
  );
  await expect(removeEntry(form({ entryId: "" }))).rejects.toThrow("Not an entry");
  expect(setEntryStatus).not.toHaveBeenCalled();
  expect(deleteEntry).not.toHaveBeenCalled();
});

test("signed out goes to sign in", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(setStatus(form({ entryId: ENTRY, status: "finished" }))).rejects.toThrow("redirect:/login");
  await expect(removeEntry(form({ entryId: ENTRY }))).rejects.toThrow("redirect:/login");
  expect(setEntryStatus).not.toHaveBeenCalled();
  expect(deleteEntry).not.toHaveBeenCalled();
});

test("the Up next actions write as the signed-in user, then refresh the page", async () => {
  await addUpNext(form({ entryId: ENTRY }));
  expect(addToUpNext).toHaveBeenCalledExactlyOnceWith(client, USER.id, ENTRY);
  await removeUpNext(form({ entryId: ENTRY }));
  expect(removeFromUpNext).toHaveBeenCalledExactlyOnceWith(client, USER.id, ENTRY);
  await moveUpNext(form({ entryId: ENTRY, direction: "top" }));
  expect(moveInUpNext).toHaveBeenCalledExactlyOnceWith(client, USER.id, ENTRY, "top");
  await placeUpNext(form({ entryId: ENTRY, beforeId: OTHER }));
  expect(placeInUpNext).toHaveBeenCalledWith(client, USER.id, ENTRY, OTHER);
  await placeUpNext(form({ entryId: ENTRY, beforeId: "" }));
  expect(placeInUpNext).toHaveBeenLastCalledWith(client, USER.id, ENTRY, null);
  expect(refresh).toHaveBeenCalledTimes(5);
});

test("Up next actions refuse a bad entry id, direction or target before anything is written", async () => {
  await expect(addUpNext(form({ entryId: "nope" }))).rejects.toThrow("Not an Up next change");
  await expect(removeUpNext(form({ entryId: "" }))).rejects.toThrow("Not an Up next change");
  await expect(moveUpNext(form({ entryId: ENTRY, direction: "sideways" }))).rejects.toThrow("Not an Up next change");
  await expect(placeUpNext(form({ entryId: ENTRY, beforeId: "1 or 1=1" }))).rejects.toThrow("Not an Up next change");
  for (const fn of [addToUpNext, removeFromUpNext, moveInUpNext, placeInUpNext]) expect(fn).not.toHaveBeenCalled();
});

test("Up next actions send a signed-out visitor to sign in", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(addUpNext(form({ entryId: ENTRY }))).rejects.toThrow("redirect:/login");
  await expect(moveUpNext(form({ entryId: ENTRY, direction: "up" }))).rejects.toThrow("redirect:/login");
  expect(addToUpNext).not.toHaveBeenCalled();
  expect(moveInUpNext).not.toHaveBeenCalled();
});

test("showing and hiding queues is remembered in a cookie of hidden types", async () => {
  const data = new FormData();
  data.append("show", "show");
  await setUpNextVisibility(data);
  expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith(
    "upnext-hidden",
    "movie,game",
    expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
  );
  expect(refresh).toHaveBeenCalledOnce();
});

test("an entry the user doesn't own fails and nothing is refreshed", async () => {
  vi.mocked(setEntryStatus).mockRejectedValue(new Error("That entry isn't in your library."));
  await expect(setStatus(form({ entryId: ENTRY, status: "finished" }))).rejects.toThrow("isn't in your library");
  expect(refresh).not.toHaveBeenCalled();
});
