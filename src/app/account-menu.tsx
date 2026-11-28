import Link from "next/link";
import { Settings } from "lucide-react";
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
      {/* An icon on a phone, where the header is narrow; the word from sm. Its name is "Settings" either way. */}
      <Link href="/settings" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 text-accent-text underline sm:min-w-0">
        <Settings aria-hidden="true" className="size-4 sm:hidden" />
        <span className="sr-only sm:not-sr-only">Settings</span>
      </Link>
      <form action={signOut}>
        <button type="submit" className="min-h-11 text-accent-text underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
