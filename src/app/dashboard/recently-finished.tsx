import { PosterRail } from "@/components/poster-rail";
import type { FinishedEntry } from "@/lib/library/dashboard";
import { formatDay } from "@/lib/library/dashboard-summary";
import { PosterCard } from "./poster-card";
import { audiobookTitle, entryTitle } from "./titles";

export function RecentlyFinished({ finished, today }: { finished: FinishedEntry[]; today: string }) {
  if (!finished.length) return null;
  return (
    <section aria-labelledby="recently-finished" className="flex flex-col gap-3">
      <h2 id="recently-finished" className="text-xl font-semibold">
        Recently finished
      </h2>
      <PosterRail label="Recently finished">
        {finished.map((e) => (
          <PosterCard
            key={e.entryId}
            title={audiobookTitle(entryTitle(e.title, e.seasonNumber), e.bookVersion)}
            imageUrl={e.imageUrl}
            mediaType={e.mediaType}
            detail={`Finished ${formatDay(e.finishedAt.slice(0, 10), today)}`}
            href="/library"
          />
        ))}
      </PosterRail>
    </section>
  );
}
