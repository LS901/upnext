import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { primaryButton, quietButton, TYPE_LABELS } from "@/app/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { inLibrary, itemKey, type ItemKey } from "@/lib/library/in-library";
import { searchIgdb } from "@/lib/providers/igdb";
import { searchTmdb } from "@/lib/providers/tmdb";
import { ProviderError, type MediaType, type Provider, type SearchResult } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import { addItem } from "./actions";
import { summarise, type Answer, type Outcome } from "./outcome";
import { MAX_QUERY_LENGTH, parseSearch, type SearchState } from "./params";
import { logProviderFailure, PROVIDER_NAMES } from "./shared";

export const metadata: Metadata = { title: "Search" };

const HIDE_LABELS: Record<MediaType, string> = { movie: "Movies", show: "TV", game: "Games" };

const input =
  "mt-1 block w-full rounded-md border border-black/20 bg-transparent px-3 py-2 dark:border-white/20";

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
      {/* Reads the session and searchParams, so it renders at request time. */}
      <Suspense>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Queries only the providers whose types aren't hidden, in parallel. A
// provider that fails (down, rate-limited) is reported, not fatal.
async function runSearch({ q, exclude }: SearchState): Promise<Outcome> {
  const hidden = new Set(exclude);
  const ask = async (
    provider: Provider,
    types: MediaType[],
    search: (q: string) => Promise<SearchResult[]>,
  ): Promise<Answer> => {
    if (types.every((t) => hidden.has(t))) return { provider, status: "skipped" };
    try {
      return { provider, status: "answered", results: await search(q) };
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      logProviderFailure(err);
      return { provider, status: "failed" };
    }
  };

  const answers = await Promise.all([ask("tmdb", ["movie", "show"], searchTmdb), ask("igdb", ["game"], searchIgdb)]);
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
  const owned = outcome
    ? await inLibrary(await createClient(), user.id, outcome.results.map(keyOf))
    : new Set<ItemKey>();

  // A provider that failed this search, or while adding from the last one.
  const failed = new Set<Provider>(outcome?.failed);
  const addFailed = [params.failed].flat()[0];
  if (addFailed === "tmdb" || addFailed === "igdb") failed.add(addFailed);

  return (
    <div className="mt-6 grid gap-8 md:grid-cols-[1fr_10rem]">
      <div className="flex flex-col gap-6">
        <form id="search" action="/search" role="search" className="flex items-end gap-3">
          <label className="block flex-1">
            Search movies, TV and games
            <input name="q" type="search" defaultValue={state.q} maxLength={MAX_QUERY_LENGTH} className={input} />
          </label>
          <button type="submit" className={primaryButton}>
            Search
          </button>
        </form>

        {[...failed].map((provider) => (
          <p key={provider} role="alert" className="text-red-700 dark:text-red-400">
            Couldn&apos;t reach {PROVIDER_NAMES[provider]} right now.
          </p>
        ))}

        {!outcome && <p className="text-zinc-600 dark:text-zinc-400">Type a title to search.</p>}
        {outcome?.nothingFound && (
          <p className="text-zinc-600 dark:text-zinc-400">Nothing found.</p>
        )}
        {outcome && outcome.results.length > 0 && (
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {outcome.results.map((r) => (
              <Result key={keyOf(r)} result={r} owned={owned.has(keyOf(r))} state={state} />
            ))}
          </ul>
        )}
      </div>

      {/* The checkboxes belong to the search form through form="search". */}
      <aside>
        <h2 className="font-medium">Hide</h2>
        <div className="mt-2 flex flex-wrap gap-4 md:flex-col md:gap-2">
          {(Object.keys(HIDE_LABELS) as MediaType[]).map((type) => (
            <label key={type} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="exclude"
                value={type}
                form="search"
                defaultChecked={state.exclude.includes(type)}
              />
              {HIDE_LABELS[type]}
            </label>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Result({ result: r, owned, state }: { result: SearchResult; owned: boolean; state: SearchState }) {
  return (
    <li className="flex items-center gap-4 py-3">
      {r.imageUrl ? (
        <Image src={r.imageUrl} alt="" width={48} height={72} unoptimized className="h-18 w-12 rounded object-cover" />
      ) : (
        <div className="h-18 w-12 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
      )}
      <div className="flex-1">
        <h2 className="font-medium">{r.title}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {TYPE_LABELS[r.mediaType]}
          {r.year !== null && ` · ${r.year}`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {owned && (
          <button type="button" disabled className={`${quietButton} opacity-60`}>
            In your library
          </button>
        )}
        {r.mediaType === "show" ? (
          <Link href={`/search/show/${r.providerId}`} className="text-sm underline">
            Choose seasons
          </Link>
        ) : (
          !owned && (
            <form action={addItem}>
              <input type="hidden" name="provider" value={r.provider} />
              <input type="hidden" name="mediaType" value={r.mediaType} />
              <input type="hidden" name="providerId" value={r.providerId} />
              <input type="hidden" name="q" value={state.q} />
              {state.exclude.map((type) => (
                <input key={type} type="hidden" name="exclude" value={type} />
              ))}
              <button type="submit" className={quietButton}>
                Add
              </button>
            </form>
          )
        )}
      </div>
    </li>
  );
}
