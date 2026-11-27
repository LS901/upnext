import { seasonName } from "@/app/search/season-label";

/** A season reads as "{show} · Season 2" so two seasons of one show are told apart; anything else is its title. */
export function entryTitle(title: string, seasonNumber: number | null): string {
  return seasonNumber === null ? title : `${title} · ${seasonName(seasonNumber)}`;
}
