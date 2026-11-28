import { cookies } from "next/headers";
import { Library } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { TypeTabs } from "@/components/type-tabs";
import { getDashboard } from "@/lib/library/dashboard";
import { filterView, tabCounts, type TabType } from "@/lib/library/type-filter";
import { HIDDEN_COOKIE, parseHidden, QUEUE_TYPES } from "@/lib/library/up-next-order";
import { createClient } from "@/lib/supabase/server";
import { CurrentlyOn } from "./currently-on";
import { Numbers } from "./numbers";
import { RecentlyFinished } from "./recently-finished";
import { ReleaseRadar } from "./release-radar";
import { UpNextCards } from "./up-next-cards";

/** The signed-in home page. It reads only the user's own library (INV-001). */
export async function Dashboard({ userId, type }: { userId: string; type: TabType }) {
  const hidden = parseHidden((await cookies()).get(HIDDEN_COOKIE)?.value);
  // After the cookie read, so the current time is request time.
  const today = new Date().toISOString().slice(0, 10);
  const { library, stats, radar, recentlyFinished } = await getDashboard(await createClient(), userId, today, type);
  const counts = tabCounts(library);
  const { upNext, groups } = filterView(library, type);
  const empty = !groups.length && QUEUE_TYPES.every((t) => !upNext[t].length);

  const tabs = <TypeTabs current={type} counts={counts} hrefFor={(t) => (t === "all" ? "/" : `/?type=${t}`)} />;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
      {empty && type !== "all" ? (
        <>
          {tabs}
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
            Nothing here yet.{" "}
            <Link href="/search" className="inline-flex min-h-11 items-center text-accent-text underline lg:min-h-0">
              Search
            </Link>{" "}
            to add something.
          </p>
        </>
      ) : empty ? (
        <EmptyState
          icon={Library}
          text="Nothing in your library yet."
          action={{ href: "/search", label: "Search to add something" }}
        />
      ) : (
        <>
          {tabs}
          <Numbers stats={stats} />
          <CurrentlyOn groups={groups} />
          <UpNextCards upNext={upNext} hidden={hidden} only={type} />
          <ReleaseRadar radar={radar} today={today} />
          <RecentlyFinished finished={recentlyFinished} today={today} />
        </>
      )}
    </div>
  );
}
