import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import { QUEUE_LABELS } from "@/lib/library/up-next-order";
import { knownGenres, REC_TYPES, type GenrePin, type RecType } from "@/lib/recommendations/genres";
import { getGenreEntries, getPins } from "@/lib/recommendations/library";
import { genreOptions } from "@/lib/recommendations/suggest";
import { createClient } from "@/lib/supabase/server";
import { pinGenre, unpinGenre } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      {/* Reads the session, so it renders at request time. */}
      <Suspense>
        <Settings />
      </Suspense>
    </main>
  );
}

// Each setting is a section of its own, so another (the privacy switch) drops in beside it.
async function Settings() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [entries, pins] = await Promise.all([getGenreEntries(supabase, user.id), getPins(supabase, user.id)]);
  const options = await Promise.all(REC_TYPES.map((type) => genreOptions(type, knownGenres(entries, type))));

  return (
    <div className="mt-6 flex flex-col gap-10">
      <GenrePins pins={pins} options={Object.fromEntries(REC_TYPES.map((t, i) => [t, options[i]])) as Record<RecType, string[]>} />
    </div>
  );
}

function GenrePins({ pins, options }: { pins: GenrePin[]; options: Record<RecType, string[]> }) {
  return (
    <section aria-labelledby="genre-pins" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="genre-pins" className="text-xl font-semibold">
          Genre pins
        </h2>
        <p className="text-sm text-muted-foreground">Pinned genres come first in the suggestions under an empty search.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {REC_TYPES.map((type) => (
          <TypePins
            key={type}
            type={type}
            pinned={pins.filter((p) => p.mediaType === type).map((p) => p.genre)}
            options={options[type]}
          />
        ))}
      </div>
    </section>
  );
}

function TypePins({ type, pinned, options }: { type: RecType; pinned: string[]; options: string[] }) {
  const headingId = `pins-${type}`;
  const selectId = `pin-${type}`;
  const offered = options.filter((g) => !pinned.includes(g));
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border px-4 py-4">
      <h3 id={headingId} className="font-medium">
        {QUEUE_LABELS[type]}
      </h3>
      {pinned.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {pinned.map((genre) => (
            <li key={genre} className="flex items-center justify-between gap-3">
              <span className="min-w-0 [overflow-wrap:anywhere]">{genre}</span>
              <form action={unpinGenre}>
                <input type="hidden" name="mediaType" value={type} />
                <input type="hidden" name="genre" value={genre} />
                <Button type="submit" variant="secondary">
                  Remove<span className="sr-only"> {genre}</span>
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing pinned.</p>
      )}
      {offered.length > 0 ? (
        <form action={pinGenre} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="mediaType" value={type} />
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <label htmlFor={selectId}>{TYPE_LABELS[type]} genre</label>
            <select
              id={selectId}
              name="genre"
              required
              className="h-11 w-full min-w-0 rounded-md border border-input bg-secondary px-3 text-foreground lg:h-10"
            >
              {offered.map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Add</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {type === "book" && !pinned.length ? "Add a book to pick from its genres." : "No more genres to pin."}
        </p>
      )}
    </section>
  );
}
