// @vitest-environment node
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, expect, test, vi } from "vitest";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function signOutReturns(error: Error | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { signOut: vi.fn().mockResolvedValue({ error }) },
  } as never);
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(redirect).mockClear();
});

test("signOut redirects home once the session is gone", async () => {
  signOutReturns(null);
  await expect(signOut()).rejects.toThrow("redirect:/");
});

test("signOut throws instead of redirecting when Supabase fails", async () => {
  signOutReturns(new AuthRetryableFetchError("fetch failed", 0));
  await expect(signOut()).rejects.toThrow(/fetch failed/);
  expect(redirect).not.toHaveBeenCalled();
});
