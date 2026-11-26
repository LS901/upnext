import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

export type LocalSupabase = { url: string; publishableKey: string; serviceRoleKey: string };

let cached: LocalSupabase | undefined;

// The URL and keys of local Supabase (`npx supabase start`), read from the CLI,
// so e2e needs no .env.local. Each process (the runner and every worker) reads them once.
export function localSupabase(): LocalSupabase {
  if (cached) return cached;
  let output: string;
  try {
    output = execSync("npx supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("Local Supabase isn't running. Start Docker, then run: npx supabase start");
  }
  const env: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) env[match[1]] = match[2];
  }
  const url = env.API_URL;
  const publishableKey = env.PUBLISHABLE_KEY ?? env.ANON_KEY;
  const serviceRoleKey = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !serviceRoleKey) {
    throw new Error("Couldn't read the local Supabase URL and keys from `npx supabase status -o env`.");
  }
  cached = { url, publishableKey, serviceRoleKey };
  return cached;
}

// Service-role client for checking what the app wrote. Tests only read with it.
export function adminClient(): SupabaseClient<Database> {
  const { url, serviceRoleKey } = localSupabase();
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
