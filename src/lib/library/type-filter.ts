import type { LibraryView, UpNextRow } from "./queries";
import { QUEUE_LABELS, QUEUE_TYPES, type QueueType } from "./up-next-order";

/** A My library tab: everything, or one type's queue. */
export type TabType = "all" | QueueType;

export const TAB_TYPES: readonly TabType[] = ["all", ...QUEUE_TYPES];

export const TAB_LABELS: Record<TabType, string> = { all: "All", ...QUEUE_LABELS };

/** The `type` search param as a tab; anything unknown (or missing) is All. */
export function parseTabType(value: string | string[] | undefined): TabType {
  const first = Array.isArray(value) ? value[0] : value;
  return TAB_TYPES.find((t) => t === first) ?? "all";
}

type Row = LibraryView["groups"][number]["rows"][number];

// A show row (and a queued season) is TV; a series row is books.
function typeOfRow(row: Row | UpNextRow): QueueType {
  if (row.kind === "item") return row.mediaType;
  if (row.kind === "series") return "book";
  return "show";
}

/** The rows of one type only (rows are kept whole, never trimmed); All is the view itself. */
export function filterView(view: LibraryView, type: TabType): LibraryView {
  if (type === "all") return view;
  const upNext = Object.fromEntries(QUEUE_TYPES.map((t) => [t, t === type ? view.upNext[t] : []])) as LibraryView["upNext"];
  const groups = view.groups
    .map((group) => ({ ...group, rows: group.rows.filter((row) => typeOfRow(row) === type) }))
    .filter((group) => group.rows.length > 0);
  return { upNext, groups };
}

/** Library entries per type: each season and each book is one entry; a show or series row is not. */
export function tabCounts(view: LibraryView): Record<TabType, number> {
  const counts: Record<TabType, number> = { all: 0, movie: 0, show: 0, game: 0, book: 0, other: 0 };
  const add = (type: QueueType, n: number) => {
    counts[type] += n;
    counts.all += n;
  };
  for (const type of QUEUE_TYPES) add(type, view.upNext[type].length);
  for (const group of view.groups) {
    for (const row of group.rows) {
      add(typeOfRow(row), row.kind === "show" ? row.seasons.length : row.kind === "series" ? row.books.length : 1);
    }
  }
  return counts;
}
