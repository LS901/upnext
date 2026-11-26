import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; username: string };

// The signed-in user, or null. Reads the session cookie, so anything that calls
// this renders at request time and must sit inside <Suspense>.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  // getUser() checks the token with Supabase Auth rather than trusting the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  return { id: user.id, username: profile.username };
}
