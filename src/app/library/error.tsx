"use client"; // Error boundaries must be Client Components.

import { primaryButton } from "@/app/ui";

/**
 * Shown when My library or one of its actions fails. `retry` re-fetches and
 * re-renders the page (Next 16). The error itself is never shown: in
 * production it carries only a digest, and the server logs the details.
 */
export default function LibraryError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-6 text-zinc-600 dark:text-zinc-400">That change didn&apos;t save. Reload the page and try again.</p>
      <button type="button" onClick={() => retry()} className={`${primaryButton} mt-6`}>
        Reload
      </button>
    </main>
  );
}
