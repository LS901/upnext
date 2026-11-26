import "server-only";
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; username: string };

// The signed-in user, or null when there's no session or Supabase Auth rejects
// the token (401 or 403: a deleted account, a revoked session, a rotated signing
// key). Any other failure throws, so an outage never looks like being signed out.
// Reads the session cookie, so anything that calls this renders at request time
// and must sit inside <Suspense>.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  // getUser() checks the token with Supabase Auth rather than trusting the cookie.
  const auth = await supabase.auth.getUser();
  if (isAuthSessionMissingError(auth.error)) return null;
  if (isAuthApiError(auth.error) && (auth.error.status === 401 || auth.error.status === 403)) {
    return null;
  }
  if (auth.error) {
    throw new Error(`Couldn't check the session: ${auth.error.message}`, { cause: auth.error });
  }
  const { user } = auth.data;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    throw new Error(`Couldn't load the signed-in user's profile: ${profileError.message}`, {
      cause: profileError,
    });
  }
  // The sign-up trigger creates a profile for every account, so this is a bug.
  if (!profile) throw new Error(`Signed-in user ${user.id} has no profile.`);

  return { id: user.id, username: profile.username };
}
