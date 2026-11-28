import Link from "next/link";
import { Check } from "lucide-react";
import { Poster } from "@/components/poster";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import type { BookVersion } from "@/lib/library/in-library";
import type { SearchResult } from "@/lib/providers/types";
import { cn } from "@/lib/utils";
import { addItem } from "./actions";
import { pickerHref, type SearchState } from "./params";

// The card for one search result, also used by the recommendation rows.

// Stays a (disabled) button: e2e and screen readers know it by that role.
function OwnedButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-11 items-center gap-1.5 rounded-md border border-input bg-secondary px-3 text-sm font-medium text-accent-text lg:h-9"
    >
      <Check aria-hidden="true" className="size-4" />
      {label}
    </button>
  );
}

// `version` is set for books only: print, or audio.
function AddForm({ result: r, state, label, version }: { result: SearchResult; state: SearchState; label: string; version?: BookVersion }) {
  return (
    <form action={addItem}>
      <input type="hidden" name="provider" value={r.provider} />
      <input type="hidden" name="mediaType" value={r.mediaType} />
      <input type="hidden" name="providerId" value={r.providerId} />
      {version && <input type="hidden" name="version" value={version} />}
      <input type="hidden" name="q" value={state.q} />
      {state.exclude.map((type) => (
        <input key={type} type="hidden" name="exclude" value={type} />
      ))}
      <Button type="submit">{label}</Button>
    </form>
  );
}

/** `heading` is the level of the card's title: h2 in the results, h3 under a row's own h2. */
export function ResultCard({
  result: r,
  owned,
  versions,
  state,
  heading: Heading = "h2",
  className,
}: {
  result: SearchResult;
  owned: boolean;
  versions: ReadonlySet<BookVersion>;
  state: SearchState;
  heading?: "h2" | "h3";
  className?: string;
}) {
  return (
    <li className={className}>
      <Card size="sm" className={cn("flex-row items-center gap-4 px-4", className && "h-full")}>
        <Poster url={r.imageUrl} title={r.title} size="md" mediaType={r.mediaType} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Heading className="text-base font-medium [overflow-wrap:anywhere]">{r.title}</Heading>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{TYPE_LABELS[r.mediaType]}</Badge>
            {r.year !== null && <span className="tabular-nums">{r.year}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {r.mediaType === "book" ? (
              <>
                {versions.has("print") ? (
                  <OwnedButton label="In your library" />
                ) : (
                  <AddForm result={r} state={state} label="Add" version="print" />
                )}
                {versions.has("audio") ? (
                  <OwnedButton label="Audiobook in your library" />
                ) : (
                  r.hasAudiobook && <AddForm result={r} state={state} label="Add audiobook" version="audio" />
                )}
              </>
            ) : (
              <>
                {owned && <OwnedButton label="In your library" />}
                {r.mediaType === "show" ? (
                  <Link href={pickerHref(r.providerId, state)} className={buttonVariants({ variant: "secondary" })}>
                    Choose seasons
                  </Link>
                ) : (
                  !owned && <AddForm result={r} state={state} label="Add" />
                )}
              </>
            )}
          </div>
        </div>
      </Card>
    </li>
  );
}
