import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signOut } from "./login/actions";

// Reads the session, so the layout renders it inside <Suspense>.
export async function AccountMenu() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Link href="/login" className="inline-flex min-h-11 items-center text-accent-text underline">
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase"
        >
          {Array.from(user.username)[0]}
        </span>
        <span>{user.username}</span>
      </span>
      <form action={signOut}>
        <button type="submit" className="min-h-11 text-accent-text underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
