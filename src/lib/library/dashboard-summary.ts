import type { MediaType } from "@/lib/providers/types";
import type { LibraryView } from "./queries";

export type DashboardStats = {
  backlog: number;
  backlogMinutes: number;
  backlogUnknownTime: number;
  inProgress: number;
  finished: number;
};

/** Entries per status (a movie, game, book entry or season each counts 1) and Up next's time. Up next holds every `backlog` entry. */
export function summarise(view: LibraryView): DashboardStats {
  const stats: DashboardStats = { backlog: 0, backlogMinutes: 0, backlogUnknownTime: 0, inProgress: 0, finished: 0 };
  const addBacklog = (minutes: number | null) => {
    stats.backlog += 1;
    if (minutes === null) stats.backlogUnknownTime += 1;
    else stats.backlogMinutes += minutes;
  };
  for (const queue of Object.values(view.upNext)) for (const row of queue) addBacklog(row.kind === "item" ? row.minutes : row.runtimeMinutes);
  for (const group of view.groups) {
    for (const row of group.rows) {
      const entries = row.kind === "item" ? 1 : row.kind === "show" ? row.seasons.length : row.books.length;
      if (group.status === "in_progress") stats.inProgress += entries;
      else if (group.status === "finished") stats.finished += entries;
    }
  }
  return stats;
}

export function timeLeftLabel(minutes: number, unknown: number): string | null {
  const hours = Math.round(minutes / 60);
  const parts: string[] = [];
  if (minutes > 0) parts.push(hours === 0 ? "under 1 h to finish" : `about ${hours} h to finish`);
  if (unknown > 0) parts.push(`${unknown} without a time`);
  return parts.length ? parts.join(" · ") : null;
}

/** A Backlog entry that is not out yet. `releaseDate` is YYYY-MM-DD; the title is the show's for a season. */
export type RadarEntry = {
  entryId: string;
  title: string;
  mediaType: MediaType;
  imageUrl: string | null;
  releaseDate: string;
  seasonNumber: number | null;
};

export const RADAR_LIMIT = 8;

export function upcoming(entries: RadarEntry[], today: string): RadarEntry[] {
  return entries
    .filter((e) => e.releaseDate > today)
    .sort((a, b) => (a.releaseDate < b.releaseDate ? -1 : a.releaseDate > b.releaseDate ? 1 : a.title.localeCompare(b.title)))
    .slice(0, RADAR_LIMIT);
}

const DAY_MS = 86_400_000;

export function untilLabel(date: string, today: string): string {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);
  if (days === 1) return "tomorrow";
  if (days < 60) return `in ${days} days`;
  return `in ${Math.round(days / 30.44)} months`;
}

export function formatDay(date: string, today: string): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
