import { getCurrentUser } from "@/lib/auth/current-user";
import { NavLinks } from "./nav-links";

// Reads the session, so the layout renders it inside <Suspense>. Signed out, there is no nav.
export async function MainNav() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:inset-x-auto lg:bottom-auto lg:w-60 lg:shrink-0 lg:self-stretch lg:border-t-0 lg:border-r lg:pb-0"
    >
      <NavLinks />
    </nav>
  );
}
