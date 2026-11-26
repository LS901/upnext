import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Credits",
};

// INV-007: the attribution TMDB and IGDB require. Keep the TMDB sentence
// word for word; it is fixed by TMDB's API terms.
export default function CreditsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Credits</h1>
      <section className="mt-8 space-y-2">
        <h2 className="text-xl font-medium">Movies and TV</h2>
        <p>
          Movie and TV data comes from{" "}
          <a className="underline" href="https://www.themoviedb.org">
            TMDB
          </a>
          .
        </p>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </section>
      <section className="mt-8 space-y-2">
        <h2 className="text-xl font-medium">Games</h2>
        <p>
          Game data comes from{" "}
          <a className="underline" href="https://www.igdb.com">
            IGDB.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}
