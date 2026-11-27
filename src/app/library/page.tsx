import type { Metadata } from "next";
import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { seasonDetails, seasonLabel, seasonName } from "@/app/search/season-label";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDuration } from "@/lib/format/duration";
import { formatScore } from "@/lib/format/score";
import {
  getMyLibrary,
  type ItemRow,
  type LibraryGroup,
  type LibraryView,
  type SeasonRow,
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
import { addUpNext, placeUpNext, removeEntry, removeUpNext, setStatus } from "./actions";
import { QueueVisibility } from "./queue-visibility";
import { SortableQueue } from "./sortable-queue";
import { StatusSelect } from "./status-select";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = { title: "My library" };

const muted = "text-sm text-zinc-600 dark:text-zinc-400";

export default function LibraryPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
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
      <p className="mt-6 text-zinc-600 dark:text-zinc-400">
        Nothing here yet.{" "}
        <Link href="/search" className="underline">
          Search
        </Link>{" "}
        to add something.
      </p>
    );
  }
  return (
    <div className="mt-6 flex flex-col gap-10">
      <UpNext upNext={upNext} hidden={hidden} backlog={groups.find((g) => g.status === "backlog")} />
      {groups.map((group) => (
        <Group key={group.status} group={group} />
      ))}
    </div>
  );
}

// One queue per media type, each in the user's order (owner said, 2026-11-26).
function UpNext({
  upNext,
  hidden,
  backlog,
}: {
  upNext: LibraryView["upNext"];
  hidden: QueueType[];
  backlog: LibraryGroup | undefined;
}) {
  // Whether Backlog (below) has anything of each type that could be added.
  const inBacklog = (type: QueueType) =>
    !!backlog?.rows.some((r) => (r.kind === "show" ? type === "show" : r.mediaType === type));
  const counts = Object.fromEntries(QUEUE_TYPES.map((type) => [type, upNext[type].length])) as Record<QueueType, number>;
  return (
    <section aria-labelledby="up-next">
      <h2 id="up-next" className="text-xl font-semibold">
        Up next
      </h2>
      <QueueVisibility hidden={hidden} counts={counts} />
      <div className="mt-4 flex flex-col gap-6">
        {QUEUE_TYPES.filter((type) => !hidden.includes(type)).map((type) => (
          <Queue key={type} type={type} rows={upNext[type]} hasBacklog={inBacklog(type)} />
        ))}
      </div>
    </section>
  );
}

function Queue({ type, rows, hasBacklog }: { type: QueueType; rows: UpNextRow[]; hasBacklog: boolean }) {
  const id = `queue-${type}`;
  const label = QUEUE_LABELS[type];
  const order = rows.map((r) => r.entryId);
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="font-semibold">
        {label}
      </h3>
      {rows.length ? (
        <SortableQueue
          label={`${label} up next`}
          items={rows.map((row) => ({
            entryId: row.entryId,
            title: queuedTitle(row),
            row: <QueuedRow row={row} order={order} />,
          }))}
        />
      ) : (
        <p className={`mt-1 ${muted}`}>
          {hasBacklog ? "Nothing up next. Add something from your Backlog below." : "Nothing up next."}
        </p>
      )}
    </section>
  );
}

/** A queued season names its show and season, so two seasons of one show read apart. */
function queuedTitle(row: UpNextRow): string {
  if (row.kind !== "season") return row.title;
  return `${row.showTitle} · ${seasonName(row.number)}`;
}

function QueuedRow({ row, order }: { row: UpNextRow; order: string[] }) {
  const season = row.kind === "season";
  const meta = season
    ? [...seasonDetails(row), `Time to finish: ${formatDuration(row.runtimeMinutes)}`, formatScore(row.score, row.scoreCount)]
    : [itemMeta(row)];
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
      <Poster url={row.imageUrl} />
      <div className="min-w-0 flex-1">
        <h4 className="font-medium">{queuedTitle(row)}</h4>
        <p className={muted}>{meta.join(" · ")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={setStatus}>
          <input type="hidden" name="entryId" value={row.entryId} />
          <input type="hidden" name="status" value="in_progress" />
          <SubmitButton>Start</SubmitButton>
        </form>
        <MoveButton entryId={row.entryId} order={order} direction="up" label="Move up" />
        <MoveButton entryId={row.entryId} order={order} direction="down" label="Move down" />
        <MoveButton entryId={row.entryId} order={order} direction="top" label="Move to top" />
        <form action={removeUpNext}>
          <input type="hidden" name="entryId" value={row.entryId} />
          <SubmitButton>Remove from Up next</SubmitButton>
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
function MoveButton(props: { entryId: string; order: string[]; direction: Direction; label: string }) {
  const target = targetFor(props.order, props.entryId, props.direction);
  return (
    <form action={placeUpNext}>
      <input type="hidden" name="entryId" value={props.entryId} />
      <input type="hidden" name="beforeId" value={target ? (target.beforeId ?? "") : props.entryId} />
      <SubmitButton disabled={!target}>{props.label}</SubmitButton>
    </form>
  );
}

function Group({ group }: { group: LibraryGroup }) {
  const id = `status-${group.status}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold">
        {group.label}
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-black/10 dark:divide-white/10">
        {group.rows.map((row) =>
          row.kind === "item" ? <Item key={row.entryId} item={row} /> : <Show key={row.showId} show={row} />,
        )}
      </ul>
    </section>
  );
}

function Poster({ url }: { url: string | null }) {
  return url ? (
    <Image src={url} alt="" width={48} height={72} unoptimized className="h-18 w-12 shrink-0 rounded object-cover" />
  ) : (
    <div className="h-18 w-12 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
  );
}

function itemMeta(item: ItemRow): string {
  const time =
    item.mediaType === "game"
      ? `Time to beat: ${formatDuration(item.minutes)} (story)`
      : `Time to finish: ${formatDuration(item.minutes)}`;
  return [TYPE_LABELS[item.mediaType], time, formatScore(item.score, item.scoreCount)].join(" · ");
}

function Item({ item }: { item: ItemRow }) {
  return (
    <li className="flex flex-wrap items-center gap-4 py-3">
      <Poster url={item.imageUrl} />
      <div className="min-w-0 flex-1">
        <h3 className="font-medium">{item.title}</h3>
        <p className={muted}>{itemMeta(item)}</p>
      </div>
      <EntryControls entryId={item.entryId} status={item.status} />
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
        <Poster url={show.imageUrl} />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{show.title}</h3>
          <p className={muted}>{[TYPE_LABELS.show, progress, formatScore(show.score, show.scoreCount)].join(" · ")}</p>
        </div>
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-black/5 pl-16 dark:divide-white/5">
        {show.seasons.map((season) => (
          <Season key={season.entryId} season={season} />
        ))}
      </ul>
    </li>
  );
}

function Season({ season }: { season: SeasonRow }) {
  return (
    <li className="flex flex-wrap items-center gap-4 py-2">
      <div className="min-w-0 flex-1">
        <h4>{seasonLabel(season)}</h4>
        <p className={muted}>Time to finish: {formatDuration(season.runtimeMinutes)}</p>
      </div>
      <EntryControls entryId={season.entryId} status={season.status} />
    </li>
  );
}

// Only Backlog entries can go in Up next (owner said, 2026-11-26).
function EntryControls({ entryId, status }: { entryId: string; status: EntryStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "backlog" && (
        <form action={addUpNext}>
          <input type="hidden" name="entryId" value={entryId} />
          <SubmitButton>Add to Up next</SubmitButton>
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
