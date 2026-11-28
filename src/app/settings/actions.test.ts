// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { refresh, revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { setLibraryPrivate, setUsername } from "./actions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/recommendations/library", () => ({ getGenreEntries: vi.fn() }));
vi.mock("@/lib/recommendations/suggest", () => ({ genreOptions: vi.fn() }));

const USER = { id: "user-1", username: "user-abcd1234" };
const update = vi.fn();
const eq = vi.fn();
const from = vi.fn();

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(refresh).mockClear();
  vi.mocked(revalidatePath).mockClear();
  eq.mockReset().mockResolvedValue({ error: null });
  update.mockReset().mockReturnValue({ eq });
  from.mockReset().mockReturnValue({ update });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
});

test("setLibraryPrivate sets the switch on the user's own profile when the box is ticked", async () => {
  await setLibraryPrivate(form({ private: "on" }));
  expect(from).toHaveBeenCalledWith("profiles");
  expect(update).toHaveBeenCalledExactlyOnceWith({ library_private: true });
  expect(eq).toHaveBeenCalledExactlyOnceWith("id", USER.id);
  expect(refresh).toHaveBeenCalledOnce();
});

test("setLibraryPrivate clears it when the box isn't ticked", async () => {
  await setLibraryPrivate(form({}));
  expect(update).toHaveBeenCalledExactlyOnceWith({ library_private: false });
});

test("setLibraryPrivate throws when the update fails, so the switch never looks saved", async () => {
  eq.mockResolvedValue({ error: { code: "XX000", message: "down" } });
  await expect(setLibraryPrivate(form({ private: "on" }))).rejects.toBeTruthy();
  expect(refresh).not.toHaveBeenCalled();
});

test("setUsername saves a lowercased, trimmed username on the user's own profile", async () => {
  await expect(setUsername(form({ username: "  Invented-Reader7 " }))).rejects.toThrow("redirect:/settings");
  expect(update).toHaveBeenCalledExactlyOnceWith({ username: "invented-reader7" });
  expect(eq).toHaveBeenCalledExactlyOnceWith("id", USER.id);
  // The header shows the username on every page.
  expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
});

test.each([
  ["too short", "ab"],
  ["too long", "a".repeat(31)],
  ["an email (INV-009)", "ada@example.test"],
  ["a space", "ada lovelace"],
  ["a leading hyphen", "-ada"],
  ["a slash", "ada/../x"],
])("setUsername refuses %s with a message and writes nothing", async (_name, username) => {
  await expect(setUsername(form({ username }))).rejects.toThrow("redirect:/settings?error=username");
  expect(update).not.toHaveBeenCalled();
});

test("a username someone else has is refused with its own message", async () => {
  eq.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });
  await expect(setUsername(form({ username: "taken-name" }))).rejects.toThrow("redirect:/settings?error=username-taken");
});

test("signed-out callers are sent to sign in and nothing is written", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(setLibraryPrivate(form({ private: "on" }))).rejects.toThrow("redirect:/login");
  await expect(setUsername(form({ username: "fine-name" }))).rejects.toThrow("redirect:/login");
  expect(update).not.toHaveBeenCalled();
});
