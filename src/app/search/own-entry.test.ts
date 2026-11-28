// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { addOwnEntry } from "./actions";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/catalogue/import", () => ({ importItem: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const USER = { id: "user-1", username: "user-abcd1234" };
const itemInsert = vi.fn();
const entryInsert = vi.fn();
const itemDelete = vi.fn();

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(key, v);
  return data;
}
const own = (extra: Record<string, string | string[]> = {}) =>
  form({ title: "Invented Channel Let's Play", lengthNote: "24 episodes", q: "Kestrel", ...extra });

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(redirect).mockClear();
  itemInsert.mockReset().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "item-1" }, error: null }) }) });
  entryInsert.mockReset().mockResolvedValue({ error: null });
  itemDelete.mockReset().mockReturnValue({ eq: () => ({ eq: async () => ({ error: null }) }) });
  vi.mocked(createClient).mockResolvedValue({
    from: vi.fn((table: string) =>
      table === "items" ? { insert: itemInsert, delete: itemDelete } : { insert: entryInsert },
    ),
  } as never);
});

test("adds a manual item and a Backlog entry as the user, then goes back to the search", async () => {
  await expect(addOwnEntry(own({ exclude: ["game"] }))).rejects.toThrow("redirect:/search?q=Kestrel&exclude=game&added=1");
  expect(itemInsert).toHaveBeenCalledExactlyOnceWith({
    provider: "manual",
    media_type: "other",
    provider_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    title: "Invented Channel Let's Play",
    length_note: "24 episodes",
    owner_id: USER.id,
  });
  expect(entryInsert).toHaveBeenCalledExactlyOnceWith({
    item_id: "item-1",
    item_media_type: "other",
    user_id: USER.id,
    status: "backlog",
  });
});

test("trims the title, and an empty length means none", async () => {
  await expect(addOwnEntry(own({ title: "  Spaced Out  ", lengthNote: "   " }))).rejects.toThrow("added=1");
  expect(itemInsert).toHaveBeenCalledWith(expect.objectContaining({ title: "Spaced Out", length_note: null }));
});

test("accepts exactly 200 characters of title and 100 of length", async () => {
  await expect(addOwnEntry(own({ title: "a".repeat(200), lengthNote: "b".repeat(100) }))).rejects.toThrow("added=1");
});

test.each([
  ["no title", { title: "" }],
  ["a blank title", { title: "   " }],
  ["a 201-character title", { title: "a".repeat(201) }],
  ["a 101-character length", { lengthNote: "b".repeat(101) }],
])("%s goes back with the error and the search kept, and writes nothing", async (_name, extra) => {
  await expect(addOwnEntry(own({ ...extra, exclude: ["book"] }))).rejects.toThrow(
    "redirect:/search?q=Kestrel&exclude=book&error=own-entry",
  );
  expect(itemInsert).not.toHaveBeenCalled();
  expect(entryInsert).not.toHaveBeenCalled();
});

test("a title that isn't text is refused, never cast", async () => {
  const data = own();
  data.delete("title");
  data.append("title", new Blob(["Invented"]), "t.txt");
  await expect(addOwnEntry(data)).rejects.toThrow("error=own-entry");
});

test("if the entry can't be added, the new item is removed again and the error is thrown", async () => {
  entryInsert.mockResolvedValue({ error: { code: "42501", message: "pg 42501" } });
  await expect(addOwnEntry(own())).rejects.toThrow("Couldn't add to the library: pg 42501");
  expect(itemDelete).toHaveBeenCalledOnce();
  expect(redirect).not.toHaveBeenCalled();
});

test("signed-out callers are sent to sign in and nothing is written", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(addOwnEntry(own())).rejects.toThrow("redirect:/login");
  expect(itemInsert).not.toHaveBeenCalled();
});
