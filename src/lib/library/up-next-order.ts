// Up next ordering, as pure functions. Each media type has its own queue
// (owner said, 2026-11-26): an entry's `up_next_position` only orders it
// against the same user's entries of the same type.

export type QueueType = "movie" | "show" | "game" | "book";

/** The queues in the order My library shows them. */
export const QUEUE_TYPES: readonly QueueType[] = ["movie", "show", "game"];

export const QUEUE_LABELS: Record<QueueType, string> = { movie: "Movies", show: "TV", game: "Games", book: "Books" };

export type Placed = { id: string; position: number };

export type Direction = "up" | "down" | "top";

/**
 * Movies and games queue by their type; a season queues as TV. (The column's
 * type allows "show", but the schema never lets an item entry be a show.)
 */
export function queueOf(entry: { item_media_type: QueueType | null; season_id: string | null }): QueueType {
  if (entry.season_id) return "show";
  if (entry.item_media_type) return entry.item_media_type;
  throw new Error("That entry has no queue.");
}

// Below this gap two neighbours can't be split reliably, so the queue is renumbered.
const MIN_GAP = 1e-9;

/** One new position, or (when a gap is used up) the queue's whole new order, to renumber 1..n. */
export type Placement = { kind: "one"; id: string; position: number } | { kind: "renumber"; order: string[] };

/**
 * What it takes to put `id` just before `beforeId` (`null`: at the end) in
 * `queue`, which is ordered by position. `id` may be queued already (a move)
 * or not (an add). `null` when the order wouldn't change.
 */
export function placeBefore(queue: readonly Placed[], id: string, beforeId: string | null): Placement | null {
  if (beforeId === id) return null;
  const others = queue.filter((p) => p.id !== id);
  const at = beforeId === null ? others.length : others.findIndex((p) => p.id === beforeId);
  if (at === -1) throw new Error("That entry is not in this queue.");

  const order = [...others.slice(0, at).map((p) => p.id), id, ...others.slice(at).map((p) => p.id)];
  const queued = queue.some((p) => p.id === id);
  if (queued && order.every((other, i) => queue[i]?.id === other)) return null;

  const prev = others[at - 1]?.position;
  const next = others[at]?.position;
  if (prev === undefined) return { kind: "one", id, position: next === undefined ? 1 : next - 1 };
  if (next === undefined) return { kind: "one", id, position: prev + 1 };
  const position = (prev + next) / 2;
  if (next - prev < MIN_GAP || position <= prev || position >= next) return { kind: "renumber", order };
  return { kind: "one", id, position };
}

/**
 * Where a Move button sends `id` in `order` (the queue's entry ids, in order):
 * before which entry (`null`: the end). `null` when the move does nothing
 * (already at that end, or not queued).
 */
export function targetFor(order: readonly string[], id: string, direction: Direction): { beforeId: string | null } | null {
  const i = order.indexOf(id);
  if (i === -1) return null;
  if (direction === "down") return i >= order.length - 1 ? null : { beforeId: order[i + 2] ?? null };
  if (i === 0) return null;
  return { beforeId: direction === "up" ? order[i - 1] : order[0] };
}

/** Cookie listing the queue types the user has hidden on My library (comma-separated). */
export const HIDDEN_COOKIE = "upnext-hidden";

const isQueueType = (value: string): value is QueueType => (QUEUE_TYPES as readonly string[]).includes(value);

/** The hidden types from the cookie, in queue order; anything unknown is ignored. */
export function parseHidden(value: string | undefined): QueueType[] {
  const listed = new Set((value ?? "").split(","));
  return QUEUE_TYPES.filter((type) => listed.has(type));
}

/** The cookie value for a "Show" form: every type not ticked is hidden. */
export function hiddenFromShown(shown: readonly string[]): string {
  return QUEUE_TYPES.filter((type) => !shown.filter(isQueueType).includes(type)).join(",");
}
