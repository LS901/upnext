import { Poster } from "@/components/poster";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import { formatDay, untilLabel, type RadarEntry } from "@/lib/library/dashboard-summary";
import { audiobookTitle, entryTitle } from "./titles";

/** Up next entries that are not out yet, soonest first. Only rendered when there are some. */
export function ReleaseRadar({ radar, today }: { radar: RadarEntry[]; today: string }) {
  if (!radar.length) return null;
  return (
    <section aria-labelledby="release-radar" className="flex flex-col gap-3">
      <h2 id="release-radar" className="text-xl font-semibold">
        Release radar
      </h2>
      <ul className="flex flex-col gap-3">
        {radar.map((e) => {
          const title = audiobookTitle(entryTitle(e.title, e.seasonNumber), e.bookVersion);
          return (
            <li key={e.entryId} className="flex items-center gap-3">
              <Poster url={e.imageUrl} title={title} size="sm" mediaType={e.mediaType} />
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{title}</p>
                <p className="text-sm text-muted-foreground">
                  {TYPE_LABELS[e.mediaType]} · {formatDay(e.releaseDate, today)} · {untilLabel(e.releaseDate, today)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
