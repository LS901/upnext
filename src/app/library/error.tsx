"use client"; // Error boundaries must be Client Components.

import { ErrorCard } from "@/components/error-card";

/** Shown when My library or one of its actions fails. */
export default function LibraryError({ retry }: { error: unknown; retry: () => void }) {
  return <ErrorCard retry={retry} />;
}
