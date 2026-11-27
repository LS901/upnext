import { seasonName } from "@/app/search/season-label";

/** A season reads as "{show} · Season 2" so two seasons of one show are told apart; anything else is its title. */
export function entryTitle(title: string, seasonNumber: number | null): string {
  return seasonNumber === null ? title : `${title} · ${seasonName(seasonNumber)}`;
}

/** An audiobook's title ends ` · Audiobook`; print and everything else read as their title. */
export function audiobookTitle(title: string, version: "print" | "audio" | null | undefined): string {
  return version === "audio" ? `${title} · Audiobook` : title;
}
