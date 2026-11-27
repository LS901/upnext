import { PosterRail } from "@/components/poster-rail";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import type { LibraryView } from "@/lib/library/queries";
import type { MediaType } from "@/lib/providers/types";
import { PosterCard } from "./poster-card";
import { audiobookTitle, entryTitle } from "./titles";

type Card = { key: string; title: string; imageUrl: string | null; mediaType: MediaType };

/** The In progress group: one card per movie, game or book, and one per season of each show. */
export function CurrentlyOn({ groups }: { groups: LibraryView["groups"] }) {
  const cards = (groups.find((g) => g.status === "in_progress")?.rows ?? []).flatMap((row): Card[] =>
    row.kind === "item"
      ? [{ key: row.entryId, title: audiobookTitle(row.title, row.version), imageUrl: row.imageUrl, mediaType: row.mediaType }]
      : row.kind === "series"
        ? row.books.map((b) => ({ key: b.entryId, title: audiobookTitle(b.title, b.version), imageUrl: b.imageUrl, mediaType: b.mediaType }))
        : row.seasons.map((s) => ({
          key: s.entryId,
          title: entryTitle(row.title, s.number),
          imageUrl: row.imageUrl,
          mediaType: "show" as const,
        })),
  );
  if (!cards.length) return null;
  return (
    <section aria-labelledby="currently-on" className="flex flex-col gap-3">
      <h2 id="currently-on" className="text-xl font-semibold">
        Currently on
      </h2>
      <PosterRail label="Currently on">
        {cards.map((c) => (
          <PosterCard
            key={c.key}
            title={c.title}
            imageUrl={c.imageUrl}
            mediaType={c.mediaType}
            detail={TYPE_LABELS[c.mediaType]}
            href="/library"
          />
        ))}
      </PosterRail>
    </section>
  );
}
