// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { saveEntryNote } from "@/lib/library/notes";
import { createClient } from "@/lib/supabase/server";
import { saveNote } from "./actions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/library/notes", () => ({ saveEntryNote: vi.fn(), NOTE_MAX: 2000 }));

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
  vi.mocked(createClient).mockResolvedValue(client as never);
  vi.mocked(saveEntryNote).mockReset().mockResolvedValue();
  vi.mocked(refresh).mockClear();
});

test("saveNote saves the trimmed note on the user's entry, as the user, then refreshes", async () => {
  await saveNote(form({ entryId: ENTRY, body: "  Invented thoughts.\nSecond line.  " }));
  expect(saveEntryNote).toHaveBeenCalledExactlyOnceWith(client, USER.id, ENTRY, "Invented thoughts.\nSecond line.");
  expect(refresh).toHaveBeenCalledOnce();
});

test("an empty or blank note is passed on as empty, which deletes it", async () => {
  await saveNote(form({ entryId: ENTRY, body: "   " }));
  await saveNote(form({ entryId: ENTRY }));
  expect(vi.mocked(saveEntryNote).mock.calls).toEqual([
    [client, USER.id, ENTRY, ""],
    [client, USER.id, ENTRY, ""],
  ]);
});

test("a note holds 2000 characters (emoji count as one), and longer is refused", async () => {
  await saveNote(form({ entryId: ENTRY, body: "🎃".repeat(2000) }));
  expect(saveEntryNote).toHaveBeenCalledOnce();
  await expect(saveNote(form({ entryId: ENTRY, body: "n".repeat(2001) }))).rejects.toThrow("up to 2000 characters");
  expect(saveEntryNote).toHaveBeenCalledOnce();
});

test("a bad entry id is refused, and signed out goes to sign in, before anything is written", async () => {
  await expect(saveNote(form({ entryId: "nope", body: "x" }))).rejects.toThrow();
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(saveNote(form({ entryId: ENTRY, body: "x" }))).rejects.toThrow("redirect:/login");
  expect(saveEntryNote).not.toHaveBeenCalled();
});
