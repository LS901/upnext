import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpToLine, type LucideIcon } from "lucide-react";
import { TypeTabs } from "@/components/type-tabs";
import { dragName } from "./drag-name";
import { StatusChip } from "@/components/status-chip";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { NOTE_MAX, getMyNotes } from "@/lib/library/notes";
import { getMyLibrary, type LibraryView, type UpNextRow } from "@/lib/library/queries";
import type { EntryStatus } from "@/lib/library/status";
import { filterView, parseTabType, tabCounts, type TabType } from "@/lib/library/type-filter";
import {
  HIDDEN_COOKIE,
  parseHidden,
  QUEUE_LABELS,
  QUEUE_TYPES,
  targetFor,
  type Direction,
  type QueueType,
} from "@/lib/library/up-next-order";
import { getListMemberships, getMyLists, type ListSummary } from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";
import { addToList } from "../lists/actions";
import { placeUpNext, playAgain, removeEntry, saveNote, setBookExclusions, setSeasonExclusions, setStatus } from "./actions";
import { QueueVisibility } from "./queue-visibility";
import { Group, muted, QueuedSummary, queuedRef, type EntryRef, type RowControls } from "./rows";
import { SortableQueue } from "./sortable-queue";
import { StatusSelect } from "./status-select";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = { title: "My library" };

export default function LibraryPage({ searchParams }: PageProps<"/library">) {
  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">My library</h1>
      {/* Reads the session, so it renders at request time. */}
      <Suspense>
        <Library searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Library({ searchParams }: Pick<PageProps<"/library">, "searchParams">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const type = parseTabType((await searchParams).type);
  const supabase = await createClient();
  const [full, notes, lists] = await Promise.all([
    getMyLibrary(supabase, user.id),
    getMyNotes(supabase, user.id),
    getMyLists(supabase, user.id),
  ]);
  const memberships = await getListMemberships(
    supabase,
    lists.map((l) => l.id),
  );
  const controls = ownerControls({ notes, lists, memberships });
  const counts = tabCounts(full);
  const { upNext, groups } = filterView(full, type);
  const hidden = parseHidden((await cookies()).get(HIDDEN_COOKIE)?.value);
  const tabs = <TypeTabs current={type} counts={counts} hrefFor={(t) => (t === "all" ? "/library" : `/library?type=${t}`)} />;
  if (!groups.length && QUEUE_TYPES.every((t) => !upNext[t].length)) {
    return (
      <div className="mt-6 flex flex-col gap-6">
        {tabs}
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
          Nothing here yet.{" "}
          <Link href="/search" className="inline-flex min-h-11 items-center text-accent-text underline lg:min-h-0">
            Search
          </Link>{" "}
          to add something.
        </p>
      </div>
    );
  }
  // What you're on comes first, so a long Up next never buries it.
  const inProgress = groups.filter((g) => g.status === "in_progress");
  const rest = groups.filter((g) => g.status !== "in_progress");
  return (
    <div className="mt-6 flex flex-col gap-10">
      {tabs}
      {inProgress.map((group) => (
        <Group key={group.status} group={group} controls={controls} />
      ))}
      <UpNext upNext={upNext} hidden={hidden} only={type} controls={controls} />
      {rest.map((group) => (
        <Group key={group.status} group={group} controls={controls} />
      ))}
    </div>
  );
}

// One queue per media type, each in the user's order (owner said, 2026-11-26),
// holding everything not started yet (owner said, 2026-11-27).
// On a type tab the Show boxes are gone and that type's queue always shows.
function UpNext({
  upNext,
  hidden,
  only,
  controls,
}: {
  upNext: LibraryView["upNext"];
  hidden: QueueType[];
  only: TabType;
  controls: Owner;
}) {
  const counts = Object.fromEntries(QUEUE_TYPES.map((type) => [type, upNext[type].length])) as Record<QueueType, number>;
  return (
    <section aria-labelledby="up-next">
      <h2 id="up-next" className="text-2xl font-semibold tracking-tight">
        Up next
      </h2>
      {only === "all" && <QueueVisibility hidden={hidden} counts={counts} />}
      <div className="mt-4 flex flex-col gap-4">
        {QUEUE_TYPES.filter((type) => (only === "all" ? !hidden.includes(type) : type === only)).map((type) => (
          <Queue key={type} type={type} rows={upNext[type]} controls={controls} />
        ))}
      </div>
    </section>
  );
}

function Queue({ type, rows, controls }: { type: QueueType; rows: UpNextRow[]; controls: Owner }) {
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
              row: <QueuedRow row={row} order={order} controls={controls} />,
            }))}
          />
        ) : (
          <p className={`px-(--card-spacing) ${muted}`}>Nothing up next.</p>
        )}
      </Card>
    </section>
  );
}

function QueuedRow({ row, order, controls }: { row: UpNextRow; order: string[]; controls: Owner }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3">
      <QueuedSummary row={row} />
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
      {controls.extras(queuedRef(row))}
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

/** My library's controls: the row's own, plus its note and its lists. Only ever the owner's (INV-002). */
type Owner = RowControls & { extras: (entry: EntryRef) => ReactNode };

function ownerControls({
  notes,
  lists,
  memberships,
}: {
  notes: Map<string, string>;
  lists: ListSummary[];
  memberships: Map<string, string[]>;
}): Owner {
  const extras = (entry: EntryRef) => (
    <EntryExtras entry={entry} note={notes.get(entry.entryId) ?? ""} lists={lists} on={memberships.get(entry.entryId) ?? []} />
  );
  return {
    entry: (entry) => (
      <>
        <EntryControls entryId={entry.entryId} status={entry.status} playCount={entry.playCount} again={entry.again} />
        {extras(entry)}
      </>
    ),
    showCount: (show) =>
      show.allSeasons.length > 0 && (
        <CountControl
          action={setSeasonExclusions}
          hidden={{ name: "showId", value: show.showId }}
          noun="season"
          items={show.allSeasons.map((s) => ({ id: s.seasonId, label: s.label, counted: !s.excluded }))}
        />
      ),
    seriesCount: (series) =>
      series.allBooks.length > 0 && (
        <CountControl
          action={setBookExclusions}
          hidden={{ name: "seriesId", value: series.seriesId }}
          noun="book"
          items={series.allBooks.map((b) => ({ id: b.itemId, label: b.label, counted: !b.excluded }))}
        />
      ),
    extras,
  };
}

// Under each entry: the lists it's on, the Add to list select and its private
// note. Native controls only, so all of it works without JavaScript.
function EntryExtras({ entry, note, lists, on }: { entry: EntryRef; note: string; lists: ListSummary[]; on: string[] }) {
  const onNames = lists.filter((l) => on.includes(l.id)).map((l) => l.name);
  const offered = lists.filter((l) => !on.includes(l.id));
  const noteId = `note-${entry.entryId}`;
  const listId = `add-${entry.entryId}`;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {onNames.length > 0 && <p className={muted}>On {onNames.join(", ")}</p>}
      {offered.length > 0 && (
        <form action={addToList} className="flex min-w-0 flex-wrap items-center gap-2">
          <input type="hidden" name="entryId" value={entry.entryId} />
          <label htmlFor={listId} className="sr-only">
            Add {entry.name} to a list
          </label>
          <select
            id={listId}
            name="listId"
            required
            className="h-11 w-full min-w-0 rounded-md border border-input bg-secondary px-3 text-sm text-foreground sm:w-64 lg:h-10"
          >
            {offered.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <SubmitButton>Add to list</SubmitButton>
        </form>
      )}
      <details>
        <summary className="w-fit cursor-pointer rounded text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Note
        </summary>
        <form action={saveNote} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="entryId" value={entry.entryId} />
          <label htmlFor={noteId} className="sr-only">
            Note for {entry.name}
          </label>
          <textarea
            id={noteId}
            name="body"
            rows={3}
            maxLength={NOTE_MAX}
            defaultValue={note}
            className="w-full min-w-0 rounded-md border border-input bg-secondary px-3 py-2 text-sm text-foreground"
          />
          <p className="text-xs text-muted-foreground">Only you can see your notes. Save it empty to delete it.</p>
          <div>
            <SubmitButton>Save note</SubmitButton>
          </div>
        </form>
      </details>
    </div>
  );
}
