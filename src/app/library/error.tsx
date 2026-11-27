"use client"; // Error boundaries must be Client Components.

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown when My library or one of its actions fails. `retry` re-fetches and
 * re-renders the page (Next 16). The error itself is never shown: in
 * production it carries only a digest, and the server logs the details.
 */
export default function LibraryError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Card className="mx-auto max-w-md text-center">
        <CardContent className="items-center gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-muted-foreground">That change didn&apos;t save. Reload the page and try again.</p>
          <Button type="button" onClick={() => retry()}>
            Reload
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
