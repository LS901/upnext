import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Check } from "lucide-react";
import { Poster } from "@/components/poster";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import { getCurrentUser } from "@/lib/auth/current-user";
import { bookVersionsInLibrary, inLibrary, itemKey, type BookVersion, type ItemKey } from "@/lib/library/in-library";
import { searchHardcover } from "@/lib/providers/hardcover";
import { searchIgdb } from "@/lib/providers/igdb";
import { searchTmdb } from "@/lib/providers/tmdb";
import { ProviderError, type MediaType, type Provider, type SearchResult } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import { addItem } from "./actions";
import { PROVIDER_TYPES, providersToAsk, summarise, type Answer, type Outcome } from "./outcome";
import { parseSearch, pickerHref, type SearchState } from "./params";
import { SearchForm } from "./search-form";
import { logProviderFailure, PROVIDER_NAMES } from "./shared";

export const metadata: Metadata = { title: "Search" };

const HIDE_LABELS: Record<MediaType, string> = { movie: "Movies", show: "TV", game: "Games", book: "Books" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
      {/* Reads the session and searchParams, so it renders at request time. */}
      <Suspense>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const SEARCHES: Record<Provider, (q: string) => Promise<SearchResult[]>> = {
  tmdb: searchTmdb,
  igdb: searchIgdb,
  hardcover: searchHardcover,
};

// Queries only the providers whose types aren't hidden (none when every type
// is), in parallel. A provider that fails (down, rate-limited) is reported,
// not fatal.
async function runSearch({ q, exclude }: SearchState): Promise<Outcome> {
  const asked = new Set(providersToAsk(exclude));
  const ask = async (provider: Provider): Promise<Answer> => {
    if (!asked.has(provider)) return { provider, status: "skipped" };
    try {
      return { provider, status: "answered", results: await SEARCHES[provider](q) };
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      logProviderFailure(err);
      return { provider, status: "failed" };
    }
  };

  const answers = await Promise.all((Object.keys(PROVIDER_TYPES) as Provider[]).map(ask));
  return summarise(answers, exclude);
}

async function SearchContent({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const state = parseSearch(params);
  // Nothing is sent to a provider for an empty query.
  const outcome = state.q ? await runSearch(state) : null;
  const keyOf = (r: SearchResult) => itemKey(r.provider, r.mediaType, r.providerId);
  // Movies, games and shows are owned or not; a book is owned per version.
  const supabase = outcome ? await createClient() : null;
  const isBook = (r: SearchResult) => r.mediaType === "book";
  const owned =
    outcome && supabase
      ? await inLibrary(supabase, user.id, outcome.results.filter((r) => !isBook(r)).map(keyOf))
      : new Set<ItemKey>();
  const versions =
    outcome && supabase
      ? await bookVersionsInLibrary(supabase, user.id, outcome.results.filter(isBook).map((r) => r.providerId))
      : new Map<string, Set<BookVersion>>();

  // A provider that failed this search, or while adding from the last one.
  const failed = new Set<Provider>(outcome?.failed);
  const addFailed = [params.failed].flat()[0];
  if (addFailed === "tmdb" || addFailed === "igdb" || addFailed === "hardcover") failed.add(addFailed);

  return (
    <div className="mt-6 grid gap-8 md:grid-cols-[1fr_10rem]">
      <div className="flex flex-col gap-6">
        <SearchForm q={state.q} exclude={state.exclude} />

        {/* Results now change without a page load, so say so to screen readers. */}
        <p role="status" className="sr-only">
          {outcome && !outcome.everythingHidden && (outcome.results.length ? resultCount(outcome.results.length) : "No results.")}
        </p>

        {[...failed].map((provider) => (
          <p key={provider} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
            Couldn&apos;t reach {PROVIDER_NAMES[provider]} right now.
          </p>
        ))}

        {!outcome && <p className="text-muted-foreground">Type a title to search.</p>}
        {outcome?.everythingHidden && (
          <p className="text-muted-foreground">Everything is hidden. Untick a type to search.</p>
        )}
        {outcome?.nothingFound && (
          <p className="text-muted-foreground">Nothing found.</p>
        )}
        {outcome && outcome.results.length > 0 && (
          <ul className="flex flex-col gap-3">
            {outcome.results.map((r) => (
              <Result
                key={keyOf(r)}
                result={r}
                owned={owned.has(keyOf(r))}
                versions={versions.get(r.providerId) ?? new Set()}
                state={state}
              />
            ))}
          </ul>
        )}
      </div>

      {/* The checkboxes belong to the search form through form="search"; ticking one searches again. */}
      <aside>
        <h2 className="text-sm font-medium text-muted-foreground">Hide</h2>
        <div className="mt-2 flex flex-wrap gap-2 md:flex-col">
          {(Object.keys(HIDE_LABELS) as (keyof typeof HIDE_LABELS)[]).map((type) => (
            <label
              key={type}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-input bg-secondary px-4 text-sm transition-[transform,color,background-color,border-color] duration-150 hover:bg-muted has-checked:border-primary has-checked:bg-primary/20 md:rounded-lg lg:min-h-9"
            >
              <input
                type="checkbox"
                name="exclude"
                value={type}
                form="search"
                defaultChecked={state.exclude.includes(type)}
                className="size-4 accent-primary"
              />
              {HIDE_LABELS[type]}
            </label>
          ))}
        </div>
      </aside>
    </div>
  );
}

function resultCount(n: number): string {
  return `${n} ${n === 1 ? "result" : "results"}.`;
}

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

function Result({
  result: r,
  owned,
  versions,
  state,
}: {
  result: SearchResult;
  owned: boolean;
  versions: ReadonlySet<BookVersion>;
  state: SearchState;
}) {
  return (
    <li>
      <Card size="sm" className="flex-row items-center gap-4 px-4">
        <Poster url={r.imageUrl} title={r.title} size="md" mediaType={r.mediaType} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-base font-medium [overflow-wrap:anywhere]">{r.title}</h2>
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
