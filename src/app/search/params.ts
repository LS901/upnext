import type { MediaType } from "@/lib/providers/types";

export const MEDIA_TYPES: readonly MediaType[] = ["movie", "show", "game"];

/** Longer queries are cut, so a pasted essay never reaches a provider. */
export const MAX_QUERY_LENGTH = 100;

export type SearchState = { q: string; exclude: MediaType[] };

type RawParams = Record<string, string | string[] | null | undefined>;

const isMediaType = (v: unknown): v is MediaType => MEDIA_TYPES.includes(v as MediaType);

/** Reads `q` and `exclude` from the page's searchParams or a form's fields. */
export function parseSearch(params: RawParams): SearchState {
  const raw = [params.q].flat()[0] ?? "";
  const q = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
  const wanted = new Set([params.exclude].flat().filter(isMediaType));
  return { q, exclude: MEDIA_TYPES.filter((t) => wanted.has(t)) };
}

/** The search page URL for a state, plus any extra params (such as `added=1`). */
export function searchHref({ q, exclude }: SearchState, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  for (const type of exclude) params.append("exclude", type);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}
