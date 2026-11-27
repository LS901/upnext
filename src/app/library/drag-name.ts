import { seasonName } from "@/app/search/season-label";
import type { UpNextRow } from "@/lib/library/queries";

/**
 * A queued season names its show and season, so two seasons of one show read
 * apart. A queued book is its own title, print or audio alike (ruling B5-a).
 */
export function queuedTitle(row: UpNextRow): string {
  if (row.kind !== "season") return row.title;
  return `${row.showTitle} · ${seasonName(row.number)}`;
}

/** What a drag names the row, so a book's print and audio entries are told apart when heard. */
export function dragName(row: UpNextRow): string {
  return row.kind === "item" && row.version === "audio" ? `${row.title} · Audiobook` : queuedTitle(row);
}
