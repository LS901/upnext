import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { Dashboard } from "./dashboard/dashboard";
import { Landing } from "./dashboard/landing";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-6">
      {/* Reads the session, so it renders at request time. */}
      <Suspense>
        <HomeContent />
      </Suspense>
    </main>
  );
}

async function HomeContent() {
  const user = await getCurrentUser();
  return user ? <Dashboard userId={user.id} /> : <Landing />;
}
