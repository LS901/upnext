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
        <a href="https://www.themoviedb.org" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG: nothing to optimise */}
          <img src="/tmdb-logo.svg" alt="TMDB" width={92} height={66} />
        </a>
        <p>
          This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
        </p>
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
