import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { bookVersionsInLibrary, inLibrary, itemKey, type BookVersion, type ItemKey } from "@/lib/library/in-library";
import { searchHardcover } from "@/lib/providers/hardcover";
import { searchIgdb } from "@/lib/providers/igdb";
import { searchTmdb } from "@/lib/providers/tmdb";
import { ProviderError, type MediaType, type Provider, type SearchResult } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import { addOwnEntry } from "./actions";
import { PROVIDER_TYPES, providersToAsk, summarise, type Answer, type Outcome } from "./outcome";
import { parseSearch, type SearchState } from "./params";
import { Recommendations, RecommendationsSkeleton } from "./recommendations";
import { ResultCard } from "./result-card";
import { SearchForm } from "./search-form";
import { logProviderFailure, OWN_LENGTH_MAX, OWN_TITLE_MAX, PROVIDER_NAMES } from "./shared";

export const metadata: Metadata = { title: "Search" };

// No box for Other: a search never asks a provider for it.
const HIDE_LABELS: Record<Exclude<MediaType, "other">, string> = { movie: "Movies", show: "TV", game: "Games", book: "Books" };

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
  manual: async () => [],
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

  const ownError = [params.error].flat()[0] === "own-entry";

  return (
    <div className="mt-6 grid gap-8 md:grid-cols-[1fr_10rem]">
      {/* min-w-0: a recommendation row scrolls inside itself instead of widening the column. */}
      <div className="flex min-w-0 flex-col gap-6">
        <SearchForm q={state.q} exclude={state.exclude} />

        {/* Results now change without a page load, so say so to screen readers. */}
        <p role="status" className="sr-only">
          {outcome && !outcome.everythingHidden && (outcome.results.length ? resultCount(outcome.results.length) : "No results.")}
        </p>

        <OwnEntryForm state={state} error={ownError} />

        {[...failed].map((provider) => (
          <p key={provider} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
            Couldn&apos;t reach {PROVIDER_NAMES[provider]} right now.
          </p>
        ))}

        {!outcome && <p className="text-muted-foreground">Type a title to search.</p>}
        {/* Only for an empty box, in a boundary of their own: the search never waits on them. */}
        {!outcome && (
          <Suspense fallback={<RecommendationsSkeleton />}>
            <Recommendations userId={user.id} state={state} />
          </Suspense>
        )}
        {outcome?.everythingHidden && (
          <p className="text-muted-foreground">Everything is hidden. Untick a type to search.</p>
        )}
        {outcome?.nothingFound && (
          <p className="text-muted-foreground">Nothing found.</p>
        )}
        {outcome && outcome.results.length > 0 && (
          <ul className="flex flex-col gap-3">
            {outcome.results.map((r) => (
              <ResultCard
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

// "Add your own": an entry that isn't from a provider (Other). A native form inside
// a <details>, so it stays quiet and works without JavaScript. The form is open
// again after a refusal, with the message beside it.
function OwnEntryForm({ state, error }: { state: SearchState; error: boolean }) {
  const field =
    "block h-11 w-full rounded-md border border-input bg-secondary px-3 text-foreground placeholder:text-muted-foreground lg:h-10";
  return (
    <details open={error || undefined} className="rounded-lg border border-border px-4 py-3">
      <summary className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-0">
        Add your own
      </summary>
      <form action={addOwnEntry} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="q" value={state.q} />
        {state.exclude.map((type) => (
          <input key={type} type="hidden" name="exclude" value={type} />
        ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Give it a title of up to {OWN_TITLE_MAX} characters.
          </p>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="own-title">Title</label>
          <input id="own-title" type="text" name="title" required autoComplete="off" className={field} />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="own-length">Length (optional)</label>
          <input
            id="own-length"
            type="text"
            name="lengthNote"
            autoComplete="off"
            placeholder="for example 24 episodes"
            aria-describedby="own-length-hint"
            className={field}
          />
          <p id="own-length-hint" className="text-muted-foreground">
            Up to {OWN_LENGTH_MAX} characters.
          </p>
        </div>
        <div>
          <Button type="submit">Add your own</Button>
        </div>
      </form>
    </details>
  );
}

function resultCount(n: number): string {
  return `${n} ${n === 1 ? "result" : "results"}.`;
}
