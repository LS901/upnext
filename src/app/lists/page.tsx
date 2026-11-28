import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/app/library/submit-button";
import { muted } from "@/app/library/rows";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getMyLists, LIST_NAME_MAX, type ListSummary } from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";
import { createList, deleteList, renameList, setListPrivate } from "./actions";

export const metadata: Metadata = { title: "Lists" };

const ERRORS: Record<string, string> = {
  name: `Give the list a name of up to ${LIST_NAME_MAX} characters.`,
  confirm: "Tick the box to confirm, then delete.",
};

export default function ListsPage({ searchParams }: PageProps<"/lists">) {
  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Lists</h1>
      {/* Reads the session, so it renders at request time. */}
      <Suspense>
        <Lists searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const field = "h-11 w-full min-w-0 rounded-md border border-input bg-secondary px-3 text-foreground lg:h-10";

async function Lists({ searchParams }: Pick<PageProps<"/lists">, "searchParams">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const error = ERRORS[[(await searchParams).error].flat()[0] ?? ""] ?? null;
  const supabase = await createClient();
  const [lists, profile] = await Promise.all([
    getMyLists(supabase, user.id),
    supabase.from("profiles").select("library_private").eq("id", user.id).single(),
  ]);
  if (profile.error) throw profile.error;

  return (
    <div className="mt-6 flex flex-col gap-8">
      <p className={muted}>
        Group entries from My library. A public list can be seen by anyone, from your profile.
        {profile.data.library_private && (
          <>
            {" "}
            Your library is private, so nobody else sees any of your lists.{" "}
            <Link href="/settings" className="text-accent-text underline">
              Settings
            </Link>
          </>
        )}
      </p>
      <form action={createList} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:max-w-md">
            {/* No maxlength: the server refuses a long name with a message. */}
            <label htmlFor="list-name">List name</label>
            <input
              id="list-name"
              name="name"
              required
              autoComplete="off"
              aria-describedby={error ? "list-error" : undefined}
              className={field}
            />
          </div>
          <Button type="submit">Create list</Button>
        </div>
        {error && (
          <p id="list-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      {lists.length ? (
        <ul className="flex flex-col gap-4">
          {lists.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
          No lists yet.
        </p>
      )}
    </div>
  );
}

// Every control names its list, so a screen reader hears which one it changes.
function ListCard({ list }: { list: ListSummary }) {
  const renameId = `rename-${list.id}`;
  return (
    <li>
      <Card className="min-w-0 gap-4 px-(--card-spacing)" size="sm">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/lists/${list.id}`}
            className="inline-flex min-h-11 w-fit max-w-full items-center font-medium text-accent-text underline [overflow-wrap:anywhere] lg:min-h-0"
          >
            {list.name}
          </Link>
          <p className={muted}>
            {list.isPrivate ? "Private" : "Public"} · {list.count === 1 ? "1 entry" : `${list.count} entries`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <form action={renameList} className="flex min-w-0 flex-1 flex-wrap items-end gap-2 basis-64">
            <input type="hidden" name="listId" value={list.id} />
            <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
              <label htmlFor={renameId}>
                Rename<span className="sr-only"> {list.name}</span>
              </label>
              <input id={renameId} name="name" required autoComplete="off" defaultValue={list.name} className={field} />
            </div>
            <SubmitButton>
              Save name<span className="sr-only"> of {list.name}</span>
            </SubmitButton>
          </form>
          {/* The button names the value it sets, so a repeat changes nothing. */}
          <form action={setListPrivate}>
            <input type="hidden" name="listId" value={list.id} />
            <input type="hidden" name="private" value={String(!list.isPrivate)} />
            <SubmitButton>
              Make<span className="sr-only"> {list.name}</span> {list.isPrivate ? "public" : "private"}
            </SubmitButton>
          </form>
        </div>
        <details>
          <summary className="w-fit cursor-pointer rounded text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Delete<span className="sr-only"> {list.name}</span>
          </summary>
          <form action={deleteList} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="listId" value={list.id} />
            <label className="flex items-start gap-2 text-sm [overflow-wrap:anywhere]">
              <input type="checkbox" name="confirm" required className="mt-1" />
              <span>Yes, delete {list.name}</span>
            </label>
            <p className={muted}>Its entries stay in your library.</p>
            <div>
              <SubmitButton>
                Delete list<span className="sr-only"> {list.name}</span>
              </SubmitButton>
            </div>
          </form>
        </details>
      </Card>
    </li>
  );
}
