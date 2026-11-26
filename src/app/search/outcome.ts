import type { MediaType, Provider, SearchResult } from "@/lib/providers/types";

/** What one provider did for a search: not asked (its types are hidden), failed, or answered. */
export type Answer =
  | { provider: Provider; status: "skipped" | "failed" }
  | { provider: Provider; status: "answered"; results: readonly SearchResult[] };

/** `everythingHidden`: no provider was asked, because every type is hidden. */
export type Outcome = { results: SearchResult[]; failed: Provider[]; nothingFound: boolean; everythingHidden: boolean };

/** The types each provider searches, in the order the providers are asked. */
export const PROVIDER_TYPES: Record<Provider, readonly MediaType[]> = { tmdb: ["movie", "show"], igdb: ["game"] };

/** The providers a search asks: each one unless every type it searches is hidden. */
export function providersToAsk(hidden: readonly MediaType[]): Provider[] {
  const hide = new Set(hidden);
  return (Object.keys(PROVIDER_TYPES) as Provider[]).filter((p) => PROVIDER_TYPES[p].some((t) => !hide.has(t)));
}

/**
 * Merges the providers' answers, dropping hidden types. "Nothing found" is
 * only true when at least one provider was asked, every one asked answered,
 * and no result is left: a failure never reads as an empty catalogue.
 */
export function summarise(answers: Answer[], hidden: readonly MediaType[]): Outcome {
  const hide = new Set(hidden);
  const results = answers
    .flatMap((a) => (a.status === "answered" ? a.results : []))
    .filter((r) => !hide.has(r.mediaType));
  const failed = answers.filter((a) => a.status === "failed").map((a) => a.provider);
  const asked = answers.filter((a) => a.status !== "skipped");
  return {
    results,
    failed,
    nothingFound: results.length === 0 && asked.length > 0 && failed.length === 0,
    everythingHidden: asked.length === 0,
  };
}
