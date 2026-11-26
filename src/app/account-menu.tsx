import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signOut } from "./login/actions";

// Reads the session, so the layout renders it inside <Suspense>.
export async function AccountMenu() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Link href="/login" className="underline">
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <span>{user.username}</span>
      <form action={signOut}>
        <button type="submit" className="underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
