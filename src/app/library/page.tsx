import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { seasonLabel } from "@/app/search/season-label";
import { quietButton, TYPE_LABELS } from "@/app/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDuration } from "@/lib/format/duration";
import { formatScore } from "@/lib/format/score";
import { getMyLibrary, type ItemRow, type LibraryGroup, type SeasonRow, type ShowRow } from "@/lib/library/queries";
import type { EntryStatus } from "@/lib/library/status";
import { createClient } from "@/lib/supabase/server";
import { removeEntry, setStatus } from "./actions";
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

  const { groups } = await getMyLibrary(await createClient(), user.id);
  if (!groups.length) {
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
      {groups.map((group) => (
        <Group key={group.status} group={group} />
      ))}
    </div>
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

function Item({ item }: { item: ItemRow }) {
  const time =
    item.mediaType === "game"
      ? `Time to beat: ${formatDuration(item.minutes)} (story)`
      : `Time to finish: ${formatDuration(item.minutes)}`;
  return (
    <li className="flex flex-wrap items-center gap-4 py-3">
      <Poster url={item.imageUrl} />
      <div className="min-w-0 flex-1">
        <h3 className="font-medium">{item.title}</h3>
        <p className={muted}>{[TYPE_LABELS[item.mediaType], time, formatScore(item.score, item.scoreCount)].join(" · ")}</p>
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

function EntryControls({ entryId, status }: { entryId: string; status: EntryStatus }) {
  return (
    <div className="flex items-center gap-3">
      <form action={setStatus}>
        <input type="hidden" name="entryId" value={entryId} />
        <StatusSelect status={status} />
      </form>
      <form action={removeEntry}>
        <input type="hidden" name="entryId" value={entryId} />
        <button type="submit" className={quietButton}>
          Remove
        </button>
      </form>
    </div>
  );
}
