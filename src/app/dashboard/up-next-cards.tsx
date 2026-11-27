import Link from "next/link";
import { setStatus } from "@/app/library/actions";
import { SubmitButton } from "@/app/library/submit-button";
import { Poster } from "@/components/poster";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LibraryView, UpNextRow } from "@/lib/library/queries";
import { QUEUE_LABELS, QUEUE_TYPES, type QueueType } from "@/lib/library/up-next-order";
import { entryTitle } from "./titles";

const SHOWN = 3;

function rowTitle(row: UpNextRow): string {
  return row.kind === "season" ? entryTitle(row.showTitle, row.number) : row.title;
}

/** The top of each queue the user hasn't hidden in My library and has something in. */
export function UpNextCards({ upNext, hidden }: { upNext: LibraryView["upNext"]; hidden: QueueType[] }) {
  const queues = QUEUE_TYPES.filter((type) => !hidden.includes(type) && upNext[type].length > 0);
  return (
    <section aria-labelledby="up-next" className="flex flex-col gap-3">
      <h2 id="up-next" className="text-xl font-semibold">
        Up next
      </h2>
      {queues.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {queues.map((type) => (
            <QueueCard key={type} type={type} rows={upNext[type].slice(0, SHOWN)} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">
          Nothing up next.{" "}
          <Link href="/library" className="inline-flex min-h-11 items-center text-accent-text underline lg:min-h-0">
            My library
          </Link>
        </p>
      )}
    </section>
  );
}

function QueueCard({ type, rows }: { type: QueueType; rows: UpNextRow[] }) {
  const id = `up-next-${type}`;
  return (
    <Card role="region" aria-labelledby={id} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h3 id={id}>{QUEUE_LABELS[type]}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.entryId} className="flex items-center gap-3">
              <Poster url={row.imageUrl} title={rowTitle(row)} size="sm" mediaType={type} />
              <span className="min-w-0 flex-1 font-medium break-words">{rowTitle(row)}</span>
              <form action={setStatus}>
                <input type="hidden" name="entryId" value={row.entryId} />
                <input type="hidden" name="status" value="in_progress" />
                <SubmitButton variant="default">Start</SubmitButton>
              </form>
            </li>
          ))}
        </ul>
        <Link
          href="/library#up-next"
          className="inline-flex min-h-11 items-center self-start text-accent-text underline lg:min-h-0"
        >
          See all<span className="sr-only"> {QUEUE_LABELS[type]} up next</span>
        </Link>
      </CardContent>
    </Card>
  );
}
