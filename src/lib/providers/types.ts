export type Provider = "tmdb" | "igdb";
export type MediaType = "movie" | "show" | "game";

export type SearchResult = {
  provider: Provider;
  providerId: string;
  mediaType: MediaType;
  title: string;
  year: number | null;
  imageUrl: string | null;
};

export type SeasonDetails = {
  number: number;
  title: string | null;
  episodeCount: number | null;
  runtimeMinutes: number | null;
  /** ISO date (YYYY-MM-DD) */
  airDate: string | null;
  /** The season's own request failed, so runtimeMinutes is unknown rather than null-by-data. */
  runtimeUnavailable: boolean;
};

/** A season as the show summary lists it: enough for the season picker. */
export type SeasonSummary = Pick<SeasonDetails, "number" | "episodeCount" | "airDate">;

export type ShowSeasons = { title: string; seasons: SeasonSummary[] };

export type TimeToBeat = {
  hastilyS: number | null;
  normallyS: number | null;
  completelyS: number | null;
  count: number | null;
};

export type ItemDetails = {
  provider: Provider;
  mediaType: MediaType;
  providerId: string;
  title: string;
  imageRef: string | null;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  score: number | null;
  scoreCount: number | null;
  timeToBeat: TimeToBeat | null;
  /** The time-to-beat request failed, so timeToBeat is unknown rather than absent (always false for TMDB). */
  timeToBeatUnavailable: boolean;
  seasons: SeasonDetails[] | null;
};

export class ProviderError extends Error {
  provider: Provider;
  status: number | null;

  constructor(provider: Provider, status: number | null, message?: string) {
    super(message ?? `${provider} request failed${status ? ` (${status})` : ""}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}
