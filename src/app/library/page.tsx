import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowDown, ArrowUp, ArrowUpToLine, type LucideIcon } from "lucide-react";
import { Poster } from "@/components/poster";
import { dragName, queuedTitle } from "./drag-name";
import { StatusChip } from "@/components/status-chip";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { seasonDetails, seasonLabel } from "@/app/search/season-label";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import { getCurrentUser } from "@/lib/auth/current-user";
import { bookMeta } from "@/lib/format/book";
import { formatDuration } from "@/lib/format/duration";
import { playAgainLabel, playCountLine } from "@/lib/format/plays";
import { formatScore } from "@/lib/format/score";
import {
  getMyLibrary,
  type ItemRow,
  type LibraryGroup,
  type LibraryView,
  type SeasonRow,
  type SeriesBookRow,
  type SeriesRow,
  type ShowRow,
  type UpNextRow,
} from "@/lib/library/queries";
import type { EntryStatus } from "@/lib/library/status";
import {
  HIDDEN_COOKIE,
  parseHidden,
  QUEUE_LABELS,
  QUEUE_TYPES,
  targetFor,
  type Direction,
  type QueueType,
} from "@/lib/library/up-next-order";
import { createClient } from "@/lib/supabase/server";
import { placeUpNext, playAgain, removeEntry, setBookExclusions, setSeasonExclusions, setStatus } from "./actions";
import { QueueVisibility } from "./queue-visibility";
import { SortableQueue } from "./sortable-queue";
import { StatusSelect } from "./status-select";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = { title: "My library" };

const muted = "text-sm text-muted-foreground break-words";

export default function LibraryPage() {
  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">My library</h1>
      {/* Reads the session, so it renders at request time. */}
      <Suspense>
        <Library />
      </Suspense>
    </main>
  );
}

async function Library() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { upNext, groups } = await getMyLibrary(await createClient(), user.id);
  const hidden = parseHidden((await cookies()).get(HIDDEN_COOKIE)?.value);
  if (!groups.length && QUEUE_TYPES.every((type) => !upNext[type].length)) {
    return (
      <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
        Nothing here yet.{" "}
        <Link href="/search" className="inline-flex min-h-11 items-center text-accent-text underline lg:min-h-0">
          Search
        </Link>{" "}
        to add something.
      </p>
    );
  }
  // What you're on comes first, so a long Up next never buries it.
  const inProgress = groups.filter((g) => g.status === "in_progress");
  const rest = groups.filter((g) => g.status !== "in_progress");
  return (
    <div className="mt-6 flex flex-col gap-10">
      {inProgress.map((group) => (
        <Group key={group.status} group={group} />
      ))}
      <UpNext upNext={upNext} hidden={hidden} />
      {rest.map((group) => (
        <Group key={group.status} group={group} />
      ))}
    </div>
  );
}

// One queue per media type, each in the user's order (owner said, 2026-11-26),
// holding everything not started yet (owner said, 2026-11-27).
function UpNext({ upNext, hidden }: { upNext: LibraryView["upNext"]; hidden: QueueType[] }) {
  const counts = Object.fromEntries(QUEUE_TYPES.map((type) => [type, upNext[type].length])) as Record<QueueType, number>;
  return (
    <section aria-labelledby="up-next">
      <h2 id="up-next" className="text-2xl font-semibold tracking-tight">
        Up next
      </h2>
      <QueueVisibility hidden={hidden} counts={counts} />
      <div className="mt-4 flex flex-col gap-4">
        {QUEUE_TYPES.filter((type) => !hidden.includes(type)).map((type) => (
          <Queue key={type} type={type} rows={upNext[type]} />
        ))}
      </div>
    </section>
  );
}

function Queue({ type, rows }: { type: QueueType; rows: UpNextRow[] }) {
  const id = `queue-${type}`;
  const label = QUEUE_LABELS[type];
  const order = rows.map((r) => r.entryId);
  return (
    <section aria-labelledby={id}>
      <Card className="min-w-0 gap-3" size="sm">
        <h3 id={id} className="px-(--card-spacing) text-base font-semibold">
          {label}
        </h3>
        {rows.length ? (
          <SortableQueue
            label={`${label} up next`}
            items={rows.map((row) => ({
              entryId: row.entryId,
              title: dragName(row),
              row: <QueuedRow row={row} order={order} />,
            }))}
          />
        ) : (
          <p className={`px-(--card-spacing) ${muted}`}>Nothing up next.</p>
        )}
      </Card>
    </section>
  );
}

function QueuedRow({ row, order }: { row: UpNextRow; order: string[] }) {
  const season = row.kind === "season";
  const meta = season
    ? [...seasonDetails(row), `Time to finish: ${formatDuration(row.runtimeMinutes)}`, formatScore(row.score, row.scoreCount)]
    : [itemMeta(row)];
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3">
      <Poster url={row.imageUrl} title={queuedTitle(row)} size="md" mediaType={season ? "show" : row.mediaType} />
      <div className="min-w-0 flex-1 basis-32">
        <h4 className="font-medium break-words">{queuedTitle(row)}</h4>
        <p className={muted}>{meta.join(" · ")}</p>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2">
        <form action={setStatus}>
          <input type="hidden" name="entryId" value={row.entryId} />
          <input type="hidden" name="status" value="in_progress" />
          <SubmitButton variant="default">Start</SubmitButton>
        </form>
        <MoveButton entryId={row.entryId} order={order} direction="up" label="Move up" icon={ArrowUp} />
        <MoveButton entryId={row.entryId} order={order} direction="down" label="Move down" icon={ArrowDown} />
        <MoveButton entryId={row.entryId} order={order} direction="top" label="Move to top" icon={ArrowUpToLine} />
        <form action={setStatus}>
          <input type="hidden" name="entryId" value={row.entryId} />
          <StatusSelect status={row.status} />
        </form>
        <form action={removeEntry}>
          <input type="hidden" name="entryId" value={row.entryId} />
          <SubmitButton>Remove</SubmitButton>
        </form>
      </div>
    </div>
  );
}

/**
 * Sends the exact place to move to (before which entry), worked out from the
 * order on this page, so a repeated click lands in the same place rather than
 * moving again. Disabled when the move would do nothing; it then targets the
 * entry itself, which moves nothing, in case it's sent before hydration.
 */
function MoveButton(props: {
  entryId: string;
  order: string[];
  direction: Direction;
  label: string;
  icon: LucideIcon;
}) {
  const Icon = props.icon;
  const target = targetFor(props.order, props.entryId, props.direction);
  return (
    <form action={placeUpNext}>
      <input type="hidden" name="entryId" value={props.entryId} />
      <input type="hidden" name="beforeId" value={target ? (target.beforeId ?? "") : props.entryId} />
      <SubmitButton disabled={!target} size="icon" variant="ghost" label={props.label}>
        <Icon aria-hidden="true" />
      </SubmitButton>
    </form>
  );
}

function Group({ group }: { group: LibraryGroup }) {
  const id = `status-${group.status}`;
  return (
    <section aria-labelledby={id}>
      <Card className="min-w-0 gap-3" size="sm">
        <h2 id={id} className="px-(--card-spacing) text-xl font-semibold">
          {group.label}
        </h2>
        <ul className="flex flex-col divide-y divide-border px-(--card-spacing)">
          {group.rows.map((row) =>
            row.kind === "item" ? (
              <Item key={row.entryId} item={row} />
            ) : row.kind === "show" ? (
              <Show key={row.showId} show={row} />
            ) : (
              <Series key={row.seriesId} series={row} />
            ),
          )}
        </ul>
      </Card>
    </section>
  );
}

function itemMeta(item: ItemRow): string {
  if (item.mediaType === "book") return bookMeta(item);
  // Other has no time, no score: its label, then the length the user typed.
  if (item.mediaType === "other") return item.lengthNote ? `${TYPE_LABELS.other} · ${item.lengthNote}` : TYPE_LABELS.other;
  const time =
    item.mediaType === "game"
      ? `Time to beat: ${formatDuration(item.minutes)} (story)`
      : `Time to finish: ${formatDuration(item.minutes)}`;
  return [TYPE_LABELS[item.mediaType], time, formatScore(item.score, item.scoreCount, item.providerName)].join(" · ");
}

function Item({ item }: { item: ItemRow }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
      <Poster url={item.imageUrl} title={item.title} size="md" mediaType={item.mediaType} />
      <div className="min-w-0 flex-1 basis-32">
        <h3 className="font-medium break-words">{item.title}</h3>
        <p className={muted}>{itemMeta(item)}</p>
        <PlayCount line={playCountLine(item.mediaType, item.version, item.playCount)} />
      </div>
      <EntryControls
        entryId={item.entryId}
        status={item.status}
        playCount={item.playCount}
        again={playAgainLabel(item.mediaType, item.version)}
      />
    </li>
  );
}

// The show's progress counts all its seasons; the rows are only the user's
// seasons in this group's status. Never a season synopsis (INV-004).
function Show({ show }: { show: ShowRow }) {
  const { finished, total } = show.progress;
  const progress = total ? `${finished} of ${total} seasons finished` : "No seasons yet";
  return (
    <li className="py-3">
      <div className="flex items-center gap-4">
        <Poster url={show.imageUrl} title={show.title} size="md" mediaType="show" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium break-words">{show.title}</h3>
          <p className={muted}>{[TYPE_LABELS.show, progress, formatScore(show.score, show.scoreCount)].join(" · ")}</p>
          {total > 0 && <Progress aria-hidden="true" value={(finished / total) * 100} className="mt-2 max-w-48" />}
        </div>
      </div>
      {show.allSeasons.length > 0 && (
        <CountControl
          action={setSeasonExclusions}
          hidden={{ name: "showId", value: show.showId }}
          noun="season"
          items={show.allSeasons.map((s) => ({ id: s.seasonId, label: s.label, counted: !s.excluded }))}
        />
      )}
      <ul className="mt-2 flex flex-col divide-y divide-border sm:pl-24">
        {show.seasons.map((season) => (
          <Season key={season.entryId} season={season} />
        ))}
      </ul>
    </li>
  );
}

// Like a show: the series' progress counts all the user's books in it, in any
// status; the rows are only the user's books in this group's status. A series
// has no score of its own, so its line carries none.
function Series({ series }: { series: SeriesRow }) {
  const { read, total } = series.progress;
  const meta = total ? `Series · ${read} of ${total} read` : "Series";
  return (
    <li className="py-3">
      <div className="flex items-center gap-4">
        <Poster url={series.books[0]?.imageUrl ?? null} title={series.title} size="md" mediaType="book" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium break-words">{series.title}</h3>
          <p className={muted}>{meta}</p>
          {total > 0 && <Progress aria-hidden="true" value={Math.min(100, (read / total) * 100)} className="mt-2 max-w-48" />}
        </div>
      </div>
      {series.allBooks.length > 0 && (
        <CountControl
          action={setBookExclusions}
          hidden={{ name: "seriesId", value: series.seriesId }}
          noun="book"
          items={series.allBooks.map((b) => ({ id: b.itemId, label: b.label, counted: !b.excluded }))}
        />
      )}
      <ul className="mt-2 flex flex-col divide-y divide-border sm:pl-24">
        {series.books.map((book) => (
          <SeriesBook key={book.entryId} book={book} />
        ))}
      </ul>
    </li>
  );
}

function SeriesBook({ book }: { book: SeriesBookRow }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-2">
      <div className="min-w-0 flex-1 basis-32">
        <h4 className="break-words">{book.position === null ? book.title : `#${book.position} ${book.title}`}</h4>
        <p className={muted}>{bookMeta(book)}</p>
        <PlayCount line={playCountLine("book", book.version, book.playCount)} />
      </div>
      <EntryControls
        entryId={book.entryId}
        status={book.status}
        playCount={book.playCount}
        again={playAgainLabel("book", book.version)}
      />
    </li>
  );
}

function Season({ season }: { season: SeasonRow }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-2">
      <div className="min-w-0 flex-1 basis-32">
        <h4 className="break-words">{seasonLabel(season)}</h4>
        <p className={muted}>Time to finish: {formatDuration(season.runtimeMinutes)}</p>
        <PlayCount line={playCountLine("show", null, season.playCount)} />
      </div>
      <EntryControls
        entryId={season.entryId}
        status={season.status}
        playCount={season.playCount}
        again={playAgainLabel("show", null)}
      />
    </li>
  );
}

// "Progress": which seasons or books count toward the row's progress. Native
// controls only, so it works without JavaScript; Save sets the exclusions to
// exactly the unticked ones (a repeat changes nothing). Each box's label names
// its own item, so a screen reader hears which one it is.
function CountControl({
  action,
  hidden,
  noun,
  items,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: { name: string; value: string };
  noun: "season" | "book";
  items: { id: string; label: string; counted: boolean }[];
}) {
  return (
    <details className="mt-2 sm:pl-24">
      <summary className="w-fit cursor-pointer rounded text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Progress
      </summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name={hidden.name} value={hidden.value} />
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex items-start gap-2 text-sm break-words">
                <input type="checkbox" name="counted" value={item.id} defaultChecked={item.counted} className="mt-1" />
                <span>
                  <span className="sr-only">Count this {noun}: </span>
                  {item.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </form>
    </details>
  );
}

function PlayCount({ line }: { line: string | null }) {
  return line && <p className={muted}>{line}</p>;
}

// The play-again button shows only on a Finished row. It names the count this
// page showed, so a repeated click counts once.
function EntryControls({
  entryId,
  status,
  playCount,
  again,
}: {
  entryId: string;
  status: EntryStatus;
  playCount: number;
  again: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip status={status} />
      {status === "finished" && (
        <form action={playAgain}>
          <input type="hidden" name="entryId" value={entryId} />
          <input type="hidden" name="expected" value={playCount} />
          <SubmitButton>{again}</SubmitButton>
        </form>
      )}
      <form action={setStatus}>
        <input type="hidden" name="entryId" value={entryId} />
        <StatusSelect status={status} />
      </form>
      <form action={removeEntry}>
        <input type="hidden" name="entryId" value={entryId} />
        <SubmitButton>Remove</SubmitButton>
      </form>
    </div>
  );
}
