import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { parseTabType } from "@/lib/library/type-filter";
import { Dashboard } from "./dashboard/dashboard";
import { Landing } from "./dashboard/landing";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-6">
      {/* Reads the session, so it renders at request time. */}
      <Suspense>
        <HomeContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function HomeContent({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const user = await getCurrentUser();
  if (!user) return <Landing />;
  return <Dashboard userId={user.id} type={parseTabType((await searchParams).type)} />;
}
