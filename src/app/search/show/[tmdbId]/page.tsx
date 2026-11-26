import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { seasonsInLibrary } from "@/lib/library/in-library";
import { getDetails } from "@/lib/providers";
import { ProviderError, type ItemDetails } from "@/lib/providers/types";
import { addSeasons } from "../../actions";
import { seasonLabel } from "../../season-label";

const button =
  "rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900";

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
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { tmdbId } = await params;
  if (!/^\d{1,12}$/.test(tmdbId)) notFound();
  const addFailed = [(await searchParams).failed].flat()[0] === "tmdb";

  // The provider client reads season numbers, episode counts, air dates and
  // runtimes only: no synopses or episode titles reach this page (INV-004).
  let show: ItemDetails;
  try {
    show = await getDetails("tmdb", "show", tmdbId);
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    if (err.status === 404) notFound();
    return <Unreachable />;
  }
  const seasons = [...(show.seasons ?? [])].sort((a, b) => a.number - b.number);
  const owned = await seasonsInLibrary(user.id, tmdbId);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{show.title}</h1>
      {addFailed && <Unreachable />}
      {seasons.length === 0 ? (
        <p className="mt-6 text-zinc-600 dark:text-zinc-400">No seasons yet.</p>
      ) : (
        <form action={addSeasons} className="mt-6 flex flex-col gap-6">
          <input type="hidden" name="tmdbId" value={tmdbId} />
          <ul className="flex flex-col gap-2">
            {seasons.map((season) => {
              const have = owned.has(season.number);
              return (
                <li key={season.number}>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="season"
                      value={season.number}
                      defaultChecked={have}
                      disabled={have}
                    />
                    {seasonLabel(season)}
                  </label>
                </li>
              );
            })}
          </ul>
          <button type="submit" className={`${button} self-start`}>
            Add seasons
          </button>
        </form>
      )}
    </>
  );
}

function Unreachable() {
  return (
    <p role="alert" className="mt-6 text-red-700 dark:text-red-400">
      Couldn&apos;t reach TMDB right now.
    </p>
  );
}
