import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { io } from "next/cache";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

// Supabase client for server components, server actions and route handlers.
// Create one per request: it reads and writes that request's session cookies.
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  // A new client reads Date.now() to check the session's expiry. Prefetches
  // prerender with the cookies resolved, and Cache Components rejects a clock
  // read there. io() keeps the rest out of every prerender (at request time
  // and inside "use cache" scopes it resolves at once).
  await io();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components can't set cookies. The proxy (src/proxy.ts)
            // refreshes the session on every request, so this write isn't needed.
          }
        },
      },
    },
  );
}
