// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteEntry, setEntryStatus } from "@/lib/library/queries";
import { createClient } from "@/lib/supabase/server";
import { removeEntry, setStatus } from "./actions";

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

const USER = { id: "user-1", username: "user-abcd1234" };
const ENTRY = "0b5d6c1e-3f7a-4d2b-9c8e-1a2b3c4d5e6f";
const client = { from: vi.fn() };

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

test("an entry the user doesn't own fails and nothing is refreshed", async () => {
  vi.mocked(setEntryStatus).mockRejectedValue(new Error("That entry isn't in your library."));
  await expect(setStatus(form({ entryId: ENTRY, status: "finished" }))).rejects.toThrow("isn't in your library");
  expect(refresh).not.toHaveBeenCalled();
});
