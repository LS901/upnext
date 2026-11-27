import type { Provider, ProviderError } from "@/lib/providers/types";

export const PROVIDER_NAMES: Record<Provider, string> = { tmdb: "TMDB", igdb: "IGDB", hardcover: "Hardcover" };

/** A TMDB or IGDB id as the forms and routes accept it. */
export const PROVIDER_ID = /^\d{1,12}$/;

/**
 * Logs a provider failure where it becomes "Couldn't reach … right now.":
 * the provider and HTTP status only, never the query or anything about the
 * user (INV-006).
 */
export function logProviderFailure(err: ProviderError): void {
  console.error(`${PROVIDER_NAMES[err.provider]} request failed (status ${err.status ?? "none"})`);
}
