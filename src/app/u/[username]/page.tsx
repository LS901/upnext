import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TypeTabs } from "@/components/type-tabs";
import { Card } from "@/components/ui/card";
import { Group, muted, QueuedSummary, READ_ONLY } from "@/app/library/rows";
import { getPublicLibrary } from "@/lib/library/public-library";
import type { UpNextRow } from "@/lib/library/queries";
import { filterView, parseTabType, tabCounts } from "@/lib/library/type-filter";
import { QUEUE_LABELS, QUEUE_TYPES, type QueueType } from "@/lib/library/up-next-order";
import { getPublicLists } from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";

// A public profile: another user's library, read-only, and their public lists.
// Anyone can view it, signed in or not. A private library and an unknown
// username get the same page with the same status, so it never says which
// (INV-002). It never shows notes, exclusion controls or an email (INV-009);
// the title is fixed for the same reason.
export const metadata: Metadata = { title: "Profile" };

const PRIVATE_OR_MISSING = "This library is private or doesn't exist.";

export default function ProfilePage({ params, searchParams }: PageProps<"/u/[username]">) {
  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 flex-1 px-4 py-10 sm:px-6">
      {/* Reads the database at request time: a privacy switch applies at once, so nothing here is cached. */}
      <Suspense>
        <Profile params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Profile({ params, searchParams }: PageProps<"/u/[username]">) {
  const { username } = await params;
  const supabase = await createClient();
  const [view, lists] = await Promise.all([getPublicLibrary(supabase, username), getPublicLists(supabase, username)]);
  if (!view) return <h1 className="text-2xl font-semibold tracking-tight">{PRIVATE_OR_MISSING}</h1>;

  const type = parseTabType((await searchParams).type);
  const counts = tabCounts(view);
  const { upNext, groups } = filterView(view, type);
  const base = `/u/${encodeURIComponent(username)}`;
  const queues = QUEUE_TYPES.filter((t) => (type === "all" ? upNext[t].length > 0 : t === type));
  const empty = !groups.length && QUEUE_TYPES.every((t) => !upNext[t].length);
  const inProgress = groups.filter((g) => g.status === "in_progress");
  const rest = groups.filter((g) => g.status !== "in_progress");

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{username}</h1>
      <div className="mt-6 flex flex-col gap-10">
        <TypeTabs current={type} counts={counts} hrefFor={(t) => (t === "all" ? base : `${base}?type=${t}`)} />
        {empty ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
            Nothing here yet.
          </p>
        ) : (
          <>
            {inProgress.map((group) => (
              <Group key={group.status} group={group} controls={READ_ONLY} />
            ))}
            {queues.length > 0 && (
              <section aria-labelledby="up-next">
                <h2 id="up-next" className="text-2xl font-semibold tracking-tight">
                  Up next
                </h2>
                <div className="mt-4 flex flex-col gap-4">
                  {queues.map((t) => (
                    <Queue key={t} type={t} rows={upNext[t]} />
                  ))}
                </div>
              </section>
            )}
            {rest.map((group) => (
              <Group key={group.status} group={group} controls={READ_ONLY} />
            ))}
          </>
        )}
        {lists.length > 0 && (
          <section aria-labelledby="lists">
            <h2 id="lists" className="text-2xl font-semibold tracking-tight">
              Lists
            </h2>
            <ul className="mt-4 flex flex-col gap-2">
              {lists.map((list) => (
                <li key={list.id} className="flex flex-wrap items-baseline gap-x-3">
                  <Link
                    href={`/lists/${list.id}`}
                    className="inline-flex min-h-11 min-w-0 items-center font-medium text-accent-text underline [overflow-wrap:anywhere] lg:min-h-0"
                  >
                    {list.name}
                  </Link>
                  <span className={muted}>{list.count === 1 ? "1 entry" : `${list.count} entries`}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

// A queue in its owner's order, read-only: no Start, Move, Remove or drag.
function Queue({ type, rows }: { type: QueueType; rows: UpNextRow[] }) {
  const id = `queue-${type}`;
  const label = QUEUE_LABELS[type];
  return (
    <section aria-labelledby={id}>
      <Card className="min-w-0 gap-3" size="sm">
        <h3 id={id} className="px-(--card-spacing) text-base font-semibold">
          {label}
        </h3>
        {rows.length ? (
          <ol aria-label={`${label} up next`} className="flex flex-col divide-y divide-border px-(--card-spacing)">
            {rows.map((row) => (
              <li key={row.entryId} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 py-3">
                <QueuedSummary row={row} />
              </li>
            ))}
          </ol>
        ) : (
          <p className={`px-(--card-spacing) ${muted}`}>Nothing up next.</p>
        )}
      </Card>
    </section>
  );
}
