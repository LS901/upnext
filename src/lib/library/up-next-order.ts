// Up next ordering, as pure functions. Each media type has its own queue
// (owner said, 2026-11-26): an entry's `up_next_position` only orders it
// against the same user's entries of the same type.

export type QueueType = "movie" | "show" | "game";

/** The queues in the order My library shows them. */
export const QUEUE_TYPES: readonly QueueType[] = ["movie", "show", "game"];

export const QUEUE_LABELS: Record<QueueType, string> = { movie: "Movies", show: "TV", game: "Games" };

export type Placed = { id: string; position: number };

export type Direction = "up" | "down" | "top";

/**
 * Movies and games queue by their type; a season queues as TV. (The column's
 * type allows "show", but the schema never lets an item entry be a show.)
 */
export function queueOf(entry: { item_media_type: QueueType | null; season_id: string | null }): QueueType {
  return entry.season_id ? "show" : (entry.item_media_type ?? "movie");
}

// Below this gap two neighbours can't be split reliably, so the queue is renumbered.
const MIN_GAP = 1e-9;

/**
 * The position writes that put `id` just before `beforeId` (`null`: at the end)
 * in `queue`, which is ordered by position. `id` may be in the queue already
 * (a move) or not (an add). Usually one write; a renumber when a gap is used
 * up. Empty when the order wouldn't change.
 */
export function placeBefore(queue: readonly Placed[], id: string, beforeId: string | null): Placed[] {
  if (beforeId === id) return [];
  const others = queue.filter((p) => p.id !== id);
  const at = beforeId === null ? others.length : others.findIndex((p) => p.id === beforeId);
  if (at === -1) throw new Error("That entry is not in this queue.");

  const order = [...others.slice(0, at).map((p) => p.id), id, ...others.slice(at).map((p) => p.id)];
  const queued = queue.some((p) => p.id === id);
  if (queued && order.every((other, i) => queue[i]?.id === other)) return [];

  const prev = others[at - 1]?.position;
  const next = others[at]?.position;
  let position: number;
  if (prev === undefined && next === undefined) position = 1;
  else if (next === undefined) position = prev! + 1;
  else if (prev === undefined) position = next - 1;
  else position = (prev + next) / 2;

  const squeezed = prev !== undefined && next !== undefined && (next - prev < MIN_GAP || position <= prev || position >= next);
  if (!squeezed) return [{ id, position }];

  const current = new Map(queue.map((p) => [p.id, p.position]));
  return order.flatMap((other, i) => (current.get(other) === i + 1 ? [] : [{ id: other, position: i + 1 }]));
}

/**
 * Where a button move sends `id`: before which entry (`null`: the end).
 * `null` when the move does nothing (already at that end, or not queued).
 */
export function targetFor(queue: readonly Placed[], id: string, direction: Direction): { beforeId: string | null } | null {
  const i = queue.findIndex((p) => p.id === id);
  if (i === -1) return null;
  if (direction === "down") return i >= queue.length - 1 ? null : { beforeId: queue[i + 2]?.id ?? null };
  if (i === 0) return null;
  return { beforeId: direction === "up" ? queue[i - 1].id : queue[0].id };
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
