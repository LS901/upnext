import { Suspense } from "react";
import { bookVersionsInLibrary, inLibrary, itemKey, type BookVersion } from "@/lib/library/in-library";
import { rowsFor, rowTitle, type GenreRow } from "@/lib/recommendations/genres";
import { getGenreEntries, getPins } from "@/lib/recommendations/library";
import { suggestByGenre } from "@/lib/recommendations/suggest";
import type { SearchResult } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import type { SearchState } from "./params";
import { ResultCard } from "./result-card";

/** Suggestions shown per row, after the ones already in the library are dropped. */
const SHOWN_PER_ROW = 10;

/**
 * Recommendation rows under an empty search box: the user's pinned genres,
 * then their library's top genres (pickRows). Only the type and the genre go to
 * a provider, and each row's suggestions are cached per (type, genre) for
 * everyone (INV-006); which of them the user owns is worked out here, per user.
 * A type hidden with the Hide boxes gets no rows.
 */
export async function Recommendations({ userId, state }: { userId: string; state: SearchState }) {
  const supabase = await createClient();
  const [entries, pins] = await Promise.all([getGenreEntries(supabase, userId), getPins(supabase, userId)]);
  if (!pins.length && !entries.some((e) => e.mediaType !== "other" && e.genres.length)) {
    return <p className="text-muted-foreground">Add a few things and we&apos;ll suggest more like them.</p>;
  }
  const rows = rowsFor(entries, pins, state.exclude);
  return (
    <div className="flex min-w-0 flex-col gap-8">
      {rows.map((row) => (
        // Each row in a boundary of its own: a slow provider holds up only its rows.
        <Suspense key={`${row.mediaType}:${row.genre}`} fallback={<RowSkeleton />}>
          <Row row={row} userId={userId} state={state} />
        </Suspense>
      ))}
    </div>
  );
}

async function Row({ row, userId, state }: { row: GenreRow; userId: string; state: SearchState }) {
  const suggestions = await suggestByGenre(row.mediaType, row.genre);
  // A failing provider, or a genre with nothing in it: the row is simply absent.
  if (!suggestions.length) return null;

  const supabase = await createClient();
  const keyOf = (r: SearchResult) => itemKey(r.provider, r.mediaType, r.providerId);
  const isBook = row.mediaType === "book";
  const [owned, versions] = await Promise.all([
    isBook ? new Set<string>() : inLibrary(supabase, userId, suggestions.map(keyOf)),
    isBook ? bookVersionsInLibrary(supabase, userId, suggestions.map((r) => r.providerId)) : new Map<string, Set<BookVersion>>(),
  ]);
  // Never anything already in the library: a book counts as owned in either version.
  const shown = suggestions.filter((r) => !owned.has(keyOf(r)) && !versions.has(r.providerId)).slice(0, SHOWN_PER_ROW);
  if (!shown.length) return null;

  const title = rowTitle(row.mediaType, row.genre);
  const id = `recs-${row.mediaType}-${encodeURIComponent(row.genre).replace(/[^A-Za-z0-9-]/g, "_")}`;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold [overflow-wrap:anywhere]">
        {title}
      </h2>
      {/* Scrolls inside itself, so the page never scrolls sideways; every card holds a focusable control. */}
      <ul className="-m-1 flex gap-3 overflow-x-auto p-1 pb-3">
        {shown.map((r) => (
          <ResultCard
            key={keyOf(r)}
            result={r}
            owned={false}
            versions={new Set()}
            state={state}
            heading="h3"
            className="w-72 shrink-0"
          />
        ))}
      </ul>
    </section>
  );
}

/** A quiet placeholder while a row loads: no text, hidden from screen readers. */
function RowSkeleton() {
  return (
    <div aria-hidden="true" data-recs-loading="" className="flex flex-col gap-3">
      <div className="h-6 w-56 max-w-full rounded bg-secondary motion-safe:animate-pulse" />
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-36 w-72 shrink-0 rounded-xl bg-secondary/60 motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export function RecommendationsSkeleton() {
  return <RowSkeleton />;
}
