import { cookies } from "next/headers";
import { Library } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getDashboard } from "@/lib/library/dashboard";
import { HIDDEN_COOKIE, parseHidden, QUEUE_TYPES } from "@/lib/library/up-next-order";
import { createClient } from "@/lib/supabase/server";
import { CurrentlyOn } from "./currently-on";
import { Numbers } from "./numbers";
import { RecentlyFinished } from "./recently-finished";
import { ReleaseRadar } from "./release-radar";
import { UpNextCards } from "./up-next-cards";

/** The signed-in home page. It reads only the user's own library (INV-001). */
export async function Dashboard({ userId }: { userId: string }) {
  const hidden = parseHidden((await cookies()).get(HIDDEN_COOKIE)?.value);
  // After the cookie read, so the current time is request time.
  const today = new Date().toISOString().slice(0, 10);
  const { library, stats, radar, recentlyFinished } = await getDashboard(await createClient(), userId, today);
  const empty = !library.groups.length && QUEUE_TYPES.every((type) => !library.upNext[type].length);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
      {empty ? (
        <EmptyState
          icon={Library}
          text="Nothing in your library yet."
          action={{ href: "/search", label: "Search to add something" }}
        />
      ) : (
        <>
          <Numbers stats={stats} />
          <CurrentlyOn groups={library.groups} />
          <UpNextCards upNext={library.upNext} hidden={hidden} />
          <ReleaseRadar radar={radar} today={today} />
          <RecentlyFinished finished={recentlyFinished} today={today} />
        </>
      )}
    </div>
  );
}
