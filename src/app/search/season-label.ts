import type { SeasonDetails } from "@/lib/providers/types";

/**
 * "Season 2 · 8 episodes · 2022", or "Specials · …" for season 0. Unknown
 * parts are left out. Never a synopsis or episode title (INV-004).
 */
export function seasonLabel(season: Pick<SeasonDetails, "number" | "episodeCount" | "airDate">): string {
  const parts = [season.number === 0 ? "Specials" : `Season ${season.number}`];
  if (season.episodeCount !== null) {
    parts.push(`${season.episodeCount} ${season.episodeCount === 1 ? "episode" : "episodes"}`);
  }
  const year = season.airDate?.match(/^(\d{4})/)?.[1];
  if (year) parts.push(year);
  return parts.join(" · ");
}
