"use client"; // Error boundaries must be Client Components.

import { ErrorCard } from "@/components/error-card";

/** Shown when any page without its own boundary fails, including the dashboard at `/`. */
export default function RootError({ retry }: { error: unknown; retry: () => void }) {
  return <ErrorCard retry={retry} />;
}
