import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { quietButton } from "@/app/ui";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import { getCurrentUser } from "@/lib/auth/current-user";
import { inLibrary, itemKey, type ItemKey } from "@/lib/library/in-library";
import { searchIgdb } from "@/lib/providers/igdb";
import { searchTmdb } from "@/lib/providers/tmdb";
import { ProviderError, type MediaType, type Provider, type SearchResult } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import { addItem } from "./actions";
import { PROVIDER_TYPES, providersToAsk, summarise, type Answer, type Outcome } from "./outcome";
import { parseSearch, type SearchState } from "./params";
import { SearchForm } from "./search-form";
import { logProviderFailure, PROVIDER_NAMES } from "./shared";

export const metadata: Metadata = { title: "Search" };

const HIDE_LABELS: Record<MediaType, string> = { movie: "Movies", show: "TV", game: "Games" };

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

const SEARCHES: Record<Provider, (q: string) => Promise<SearchResult[]>> = { tmdb: searchTmdb, igdb: searchIgdb };

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
        <SearchForm q={state.q} exclude={state.exclude} />

        {/* Results now change without a page load, so say so to screen readers. */}
        <p role="status" className="sr-only">
          {outcome && !outcome.everythingHidden && (outcome.results.length ? resultCount(outcome.results.length) : "No results.")}
        </p>

        {[...failed].map((provider) => (
          <p key={provider} role="alert" className="text-red-700 dark:text-red-400">
            Couldn&apos;t reach {PROVIDER_NAMES[provider]} right now.
          </p>
        ))}

        {!outcome && <p className="text-zinc-600 dark:text-zinc-400">Type a title to search.</p>}
        {outcome?.everythingHidden && (
          <p className="text-zinc-600 dark:text-zinc-400">Everything is hidden. Untick a type to search.</p>
        )}
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

      {/* The checkboxes belong to the search form through form="search"; ticking one searches again. */}
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

function resultCount(n: number): string {
  return `${n} ${n === 1 ? "result" : "results"}.`;
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
