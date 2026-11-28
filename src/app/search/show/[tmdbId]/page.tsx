import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { seasonsInLibrary } from "@/lib/library/in-library";
import { getTmdbShowSeasons } from "@/lib/providers/tmdb";
import { ProviderError, type ShowSeasons } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";
import { addSeasons } from "../../actions";
import { seasonLabel } from "../../season-label";
import { parseSearch } from "../../params";
import { logProviderFailure, PROVIDER_ID, PROVIDER_NAMES } from "../../shared";

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
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
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
  const query = await searchParams;
  const addFailed = [query.failed].flat()[0] === "tmdb";
  const search = parseSearch(query);

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
            <label className="flex min-h-11 items-center gap-3 [overflow-wrap:anywhere]">
              <input
                type="checkbox"
                name="season"
                value={season.number}
                defaultChecked={have}
                disabled={have}
                className="size-4 shrink-0 accent-primary"
              />
              {seasonLabel(season)}
            </label>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{show.title}</h1>
      {addFailed && <Unreachable />}
      {seasons.length === 0 ? (
        <p className="mt-6 text-muted-foreground">No seasons yet.</p>
      ) : addable ? (
        <form action={addSeasons} className="mt-6">
          <Card>
            <CardContent className="gap-6">
              <input type="hidden" name="tmdbId" value={tmdbId} />
              <input type="hidden" name="q" value={search.q} />
              {search.exclude.map((type) => (
                <input key={type} type="hidden" name="exclude" value={type} />
              ))}
              {list}
              <Button type="submit" className="self-start">
                Add seasons
              </Button>
            </CardContent>
          </Card>
        </form>
      ) : (
        // Every season is already in the library: nothing to add.
        <Card className="mt-6">
          <CardContent>{list}</CardContent>
        </Card>
      )}
    </>
  );
}

function Unreachable() {
  return (
    <p role="alert" className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
      Couldn&apos;t reach {PROVIDER_NAMES.tmdb} right now.
    </p>
  );
}
