import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Poster } from "@/components/poster";
import { StatusChip } from "@/components/status-chip";
import { Card } from "@/components/ui/card";
import { muted } from "@/app/library/rows";
import { SubmitButton } from "@/app/library/submit-button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getList, type ListView } from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";
import { removeFromList } from "../actions";

// One list. Its owner can take entries off it; anyone else, signed in or not,
// reads it while it's public and its owner's library is public. A private list,
// a list in a private library and no list at all get the same page with the same
// status (INV-002). The title is fixed for the same reason.
export const metadata: Metadata = { title: "List" };

const LIST_MISSING = "This list is private or doesn't exist.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ListPage({ params }: PageProps<"/lists/[id]">) {
  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* Reads the session and the database at request time; nothing is cached. */}
      <Suspense>
        <List params={params} />
      </Suspense>
    </main>
  );
}

async function List({ params }: Pick<PageProps<"/lists/[id]">, "params">) {
  const { id } = await params;
  const supabase = await createClient();
  const [list, user] = await Promise.all([UUID.test(id) ? getList(supabase, id) : null, getCurrentUser()]);
  if (!list) return <h1 className="text-2xl font-semibold tracking-tight">{LIST_MISSING}</h1>;
  const mine = user?.id === list.ownerId;

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{list.name}</h1>
      <p className={`mt-2 ${muted}`}>
        {mine ? (
          <>
            {list.isPrivate ? "Private: only you can see it." : "Public: anyone can see it while your library is public."}{" "}
            <Link href="/lists" className="text-accent-text underline">
              All your lists
            </Link>
          </>
        ) : (
          list.ownerUsername && (
            <>
              A list by{" "}
              <Link href={`/u/${encodeURIComponent(list.ownerUsername)}`} className="text-accent-text underline [overflow-wrap:anywhere]">
                {list.ownerUsername}
              </Link>
            </>
          )
        )}
      </p>
      <Entries list={list} mine={mine} />
    </>
  );
}

function Entries({ list, mine }: { list: ListView; mine: boolean }) {
  if (!list.entries.length) {
    return (
      <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
        Nothing on this list yet.
        {mine && (
          <>
            {" "}
            <Link href="/library" className="inline-flex min-h-11 items-center text-accent-text underline lg:min-h-0">
              Add entries from My library
            </Link>
          </>
        )}
      </p>
    );
  }
  return (
    <Card className="mt-6 min-w-0 gap-3" size="sm">
      <ol className="flex flex-col divide-y divide-border px-(--card-spacing)">
        {list.entries.map((entry) => (
          <li key={entry.entryId} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
            <Poster url={entry.imageUrl} title={entry.title} size="md" mediaType={entry.mediaType} />
            <div className="min-w-0 flex-1 basis-32">
              <h2 className="font-medium break-words">{entry.title}</h2>
              <p className={muted}>{entry.meta}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={entry.status} />
              {mine && (
                <form action={removeFromList}>
                  <input type="hidden" name="listId" value={list.id} />
                  <input type="hidden" name="entryId" value={entry.entryId} />
                  <SubmitButton>
                    Remove<span className="sr-only"> {entry.name} from the list</span>
                  </SubmitButton>
                </form>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
