import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache, Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { seasonsInLibrary } from "@/lib/library/in-library";
import { getTmdbShowSeasons } from "@/lib/providers/tmdb";
import { ProviderError, type ShowSeasons } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import { addSeasons } from "../../actions";
import { seasonLabel } from "../../season-label";
import { logProviderFailure, primaryButton, PROVIDER_ID, PROVIDER_NAMES } from "../../shared";

// The metadata and the page share one session check and one TMDB request per render.
const currentUser = cache(getCurrentUser);
const loadShow = cache(getTmdbShowSeasons);

// The tab shows the show's title. Signed-out visitors and bad ids get the
// default title, so they cause no provider request.
export async function generateMetadata({ params }: PageProps<"/search/show/[tmdbId]">): Promise<Metadata> {
  const { tmdbId } = await params;
  if (!PROVIDER_ID.test(tmdbId) || !(await currentUser())) return {};
  try {
    return { title: (await loadShow(tmdbId)).title };
  } catch (err) {
    if (err instanceof ProviderError) return {}; // the page reports it
    throw err;
  }
}

export default function SeasonPickerPage({ params, searchParams }: PageProps<"/search/show/[tmdbId]">) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      {/* Reads the session, params and searchParams, so it renders at request time. */}
      <Suspense>
        <SeasonPicker params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SeasonPicker({ params, searchParams }: PageProps<"/search/show/[tmdbId]">) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { tmdbId } = await params;
  if (!PROVIDER_ID.test(tmdbId)) notFound();
  const addFailed = [(await searchParams).failed].flat()[0] === "tmdb";

  // One summary request: season numbers, episode counts and air dates only,
  // no synopses or episode titles (INV-004).
  let show: ShowSeasons;
  try {
    show = await loadShow(tmdbId);
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    if (err.status === 404) notFound();
    logProviderFailure(err);
    return <Unreachable />;
  }
  const seasons = [...show.seasons].sort((a, b) => a.number - b.number);
  const owned = await seasonsInLibrary(await createClient(), user.id, tmdbId);
  const addable = seasons.some((s) => !owned.has(s.number));

  const list = (
    <ul className="flex flex-col gap-2">
      {seasons.map((season) => {
        const have = owned.has(season.number);
        return (
          <li key={season.number}>
            <label className="flex items-center gap-3">
              <input type="checkbox" name="season" value={season.number} defaultChecked={have} disabled={have} />
              {seasonLabel(season)}
            </label>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{show.title}</h1>
      {addFailed && <Unreachable />}
      {seasons.length === 0 ? (
        <p className="mt-6 text-zinc-600 dark:text-zinc-400">No seasons yet.</p>
      ) : addable ? (
        <form action={addSeasons} className="mt-6 flex flex-col gap-6">
          <input type="hidden" name="tmdbId" value={tmdbId} />
          {list}
          <button type="submit" className={`${primaryButton} self-start`}>
            Add seasons
          </button>
        </form>
      ) : (
        // Every season is already in the library: nothing to add.
        <div className="mt-6">{list}</div>
      )}
    </>
  );
}

function Unreachable() {
  return (
    <p role="alert" className="mt-6 text-red-700 dark:text-red-400">
      Couldn&apos;t reach {PROVIDER_NAMES.tmdb} right now.
    </p>
  );
}
