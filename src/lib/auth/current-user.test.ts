// @vitest-environment node
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, expect, test, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "./current-user";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const USER_ID = "00000000-0000-4000-8000-000000000001";

type AuthResult = { data: { user: { id: string } | null }; error: Error | null };
type ProfileResult = { data: { username: string } | null; error: { message: string } | null };

// A stand-in for the Supabase client: just the calls getCurrentUser makes.
function fakeClient(auth: AuthResult, profile?: ProfileResult) {
  const maybeSingle = vi.fn().mockResolvedValue(profile);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: { getUser: vi.fn().mockResolvedValue(auth) },
    from: vi.fn(() => ({ select })),
  };
}

function useClient(client: ReturnType<typeof fakeClient>) {
  vi.mocked(createClient).mockResolvedValue(client as never);
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
});

test("returns null when there is no session", async () => {
  useClient(fakeClient({ data: { user: null }, error: new AuthSessionMissingError() }));
  await expect(getCurrentUser()).resolves.toBeNull();
});

test("throws on any other auth error", async () => {
  useClient(fakeClient({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) }));
  await expect(getCurrentUser()).rejects.toThrow(/fetch failed/);
});

test("throws when the profile query fails", async () => {
  useClient(
    fakeClient(
      { data: { user: { id: USER_ID } }, error: null },
      { data: null, error: { message: "permission denied for table profiles" } },
    ),
  );
  await expect(getCurrentUser()).rejects.toThrow(/permission denied/);
});

test("throws when the signed-in user has no profile", async () => {
  useClient(fakeClient({ data: { user: { id: USER_ID } }, error: null }, { data: null, error: null }));
  await expect(getCurrentUser()).rejects.toThrow(/no profile/i);
});

test("returns the user's id and username", async () => {
  useClient(
    fakeClient(
      { data: { user: { id: USER_ID } }, error: null },
      { data: { username: "user-abcd1234" }, error: null },
    ),
  );
  await expect(getCurrentUser()).resolves.toEqual({ id: USER_ID, username: "user-abcd1234" });
});
