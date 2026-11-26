import type { Metadata } from "next";
import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { seasonLabel } from "@/app/search/season-label";
import { quietButton, TYPE_LABELS } from "@/app/ui";
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
import { HIDDEN_COOKIE, parseHidden, QUEUE_LABELS, QUEUE_TYPES, type QueueType } from "@/lib/library/up-next-order";
import { createClient } from "@/lib/supabase/server";
import { addUpNext, moveUpNext, removeEntry, removeUpNext, setStatus } from "./actions";
import { QueueVisibility } from "./queue-visibility";
import { RemoveButton } from "./remove-button";
import { SortableQueue } from "./sortable-queue";
import { StatusSelect } from "./status-select";

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
      <UpNext upNext={upNext} hidden={hidden} />
      {groups.map((group) => (
        <Group key={group.status} group={group} />
      ))}
    </div>
  );
}

// One queue per media type, each in the user's order (owner said, 2026-11-26).
function UpNext({ upNext, hidden }: { upNext: LibraryView["upNext"]; hidden: QueueType[] }) {
  return (
    <section aria-labelledby="up-next">
      <h2 id="up-next" className="text-xl font-semibold">
        Up next
      </h2>
      <QueueVisibility hidden={hidden} />
      <div className="mt-4 flex flex-col gap-6">
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
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="font-semibold">
        {label}
      </h3>
      {rows.length ? (
        // Keyed by the order, so after a save the list starts from the server's order.
        <SortableQueue
          key={rows.map((r) => r.entryId).join()}
          label={`${label} up next`}
          items={rows.map((row, i) => ({
            entryId: row.entryId,
            title: row.kind === "season" ? `${row.showTitle} ${seasonLabel(row)}` : row.title,
            row: <QueuedRow row={row} first={i === 0} last={i === rows.length - 1} />,
          }))}
        />
      ) : (
        <p className={`mt-1 ${muted}`}>Nothing up next. Add something from your Backlog below.</p>
      )}
    </section>
  );
}

function QueuedRow({ row, first, last }: { row: UpNextRow; first: boolean; last: boolean }) {
  const season = row.kind === "season";
  const meta = season
    ? [seasonLabel(row), `Time to finish: ${formatDuration(row.runtimeMinutes)}`, formatScore(row.score, row.scoreCount)]
    : [itemMeta(row)];
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
      <Poster url={row.imageUrl} />
      <div className="min-w-0 flex-1">
        <h4 className="font-medium">{season ? row.showTitle : row.title}</h4>
        <p className={muted}>{meta.join(" · ")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={setStatus}>
          <input type="hidden" name="entryId" value={row.entryId} />
          <input type="hidden" name="status" value="in_progress" />
          <button type="submit" className={quietButton}>
            Start
          </button>
        </form>
        <MoveButton entryId={row.entryId} direction="up" label="Move up" disabled={first} />
        <MoveButton entryId={row.entryId} direction="down" label="Move down" disabled={last} />
        <MoveButton entryId={row.entryId} direction="top" label="Move to top" disabled={first} />
        <form action={removeUpNext}>
          <input type="hidden" name="entryId" value={row.entryId} />
          <button type="submit" className={quietButton}>
            Remove from Up next
          </button>
        </form>
      </div>
    </div>
  );
}

function MoveButton(props: { entryId: string; direction: "up" | "down" | "top"; label: string; disabled: boolean }) {
  return (
    <form action={moveUpNext}>
      <input type="hidden" name="entryId" value={props.entryId} />
      <input type="hidden" name="direction" value={props.direction} />
      <button type="submit" disabled={props.disabled} className={`${quietButton} disabled:opacity-40`}>
        {props.label}
      </button>
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
          <button type="submit" className={quietButton}>
            Add to Up next
          </button>
        </form>
      )}
      <form action={setStatus}>
        <input type="hidden" name="entryId" value={entryId} />
        <StatusSelect status={status} />
      </form>
      <form action={removeEntry}>
        <input type="hidden" name="entryId" value={entryId} />
        <RemoveButton />
      </form>
    </div>
  );
}
