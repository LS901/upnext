import type { Metadata } from "next";
import Link from "next/link";
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
import { pinGenre, setLibraryPrivate, setUsername, unpinGenre } from "./actions";

export const metadata: Metadata = { title: "Settings" };

const ERRORS: Record<string, string> = {
  username: "Use 3 to 30 lowercase letters, numbers or hyphens, starting and ending with a letter or number.",
  "username-taken": "That username is taken. Try another.",
};

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      {/* Reads the session, so it renders at request time. */}
      <Suspense>
        <Settings searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Each setting is a section of its own, so another (the privacy switch) drops in beside it.
async function Settings({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const error = ERRORS[[(await searchParams).error].flat()[0] ?? ""] ?? null;
  const supabase = await createClient();
  const [entries, pins, profile] = await Promise.all([
    getGenreEntries(supabase, user.id),
    getPins(supabase, user.id),
    supabase.from("profiles").select("library_private").eq("id", user.id).single(),
  ]);
  if (profile.error) throw profile.error;
  const options = await Promise.all(REC_TYPES.map((type) => genreOptions(type, knownGenres(entries, type))));

  return (
    <div className="mt-6 flex flex-col gap-10">
      <Profile username={user.username} error={error} />
      <Privacy isPrivate={profile.data.library_private} />
      <GenrePins pins={pins} options={Object.fromEntries(REC_TYPES.map((t, i) => [t, options[i]])) as Record<RecType, string[]>} />
    </div>
  );
}

// The username names the public profile; the profiles update policy lets a user change their own.
function Profile({ username, error }: { username: string; error: string | null }) {
  return (
    <section aria-labelledby="profile" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="profile" className="text-xl font-semibold">
          Profile
        </h2>
        <p className="text-sm text-muted-foreground">
          Your username names your public profile:{" "}
          <Link href={`/u/${encodeURIComponent(username)}`} className="text-accent-text underline [overflow-wrap:anywhere]">
            /u/{username}
          </Link>
        </p>
      </div>
      <form action={setUsername} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:max-w-sm">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            defaultValue={username}
            required
            autoComplete="off"
            aria-describedby={error ? "username-error" : undefined}
            aria-invalid={error ? true : undefined}
            className="h-11 w-full min-w-0 rounded-md border border-input bg-secondary px-3 text-foreground lg:h-10"
          />
        </div>
        <Button type="submit">
          Save<span className="sr-only"> username</span>
        </Button>
      </form>
      {error && (
        <p id="username-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

// INV-002: while it's on, nobody else sees the library, its lists or its own entries' titles.
function Privacy({ isPrivate }: { isPrivate: boolean }) {
  return (
    <section aria-labelledby="privacy" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="privacy" className="text-xl font-semibold">
          Privacy
        </h2>
        <p className="text-sm text-muted-foreground">
          Your library and your public lists can be seen by anyone, unless you keep them private. Notes are always private.
        </p>
      </div>
      <form action={setLibraryPrivate} className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="private" defaultChecked={isPrivate} className="size-4" />
          Keep my library private
        </label>
        <Button type="submit">
          Save<span className="sr-only"> privacy</span>
        </Button>
      </form>
    </section>
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
