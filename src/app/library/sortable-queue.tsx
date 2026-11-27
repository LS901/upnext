"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useOptimistic, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { placeUpNext } from "./actions";

export type QueueItem = { entryId: string; title: string; row: ReactNode };

const noSubscription = () => () => {};

/**
 * One Up next queue as a drag-and-drop list. Each row is server-rendered (its
 * buttons work without JavaScript); this adds a drag handle. A drop saves the
 * new place through the placeUpNext action, as "before the next entry".
 * The order shown is the server's, with a dropped entry shown in its new place
 * until the save and refresh bring the server's new order. The rows keep their
 * keys throughout, so focus stays on the handle that was dragged.
 */
export function SortableQueue({ label, items }: { label: string; items: QueueItem[] }) {
  const [order, setOrder] = useOptimistic(items.map((i) => i.entryId));
  const [saving, startSaving] = useTransition();
  // dnd-kit's ids must match between the server render and hydration.
  const id = useId();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(items.map((i) => [i.entryId, i]));
  const announcements = announce(order, (entryId) => byId.get(entryId)?.title ?? "Entry");

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    const moved = String(active.id);
    const form = new FormData();
    form.set("entryId", moved);
    form.set("beforeId", next[next.indexOf(moved) + 1] ?? "");
    startSaving(async () => {
      setOrder(next);
      await placeUpNext(form);
    });
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol aria-label={label} aria-busy={saving} className="mt-2 flex flex-col divide-y divide-black/10 dark:divide-white/10">
          {order.map((entryId, i) => {
            const item = byId.get(entryId);
            return item ? (
              <SortableRow key={entryId} item={item} place={i + 1} hydrated={hydrated} saving={saving} />
            ) : null;
          })}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

/**
 * What a screen reader hears during a drag: titles and places, such as
 * "Moss Archive moved to position 1 of 3." (dnd-kit's defaults read out ids).
 */
function announce(order: string[], titleOf: (entryId: string) => string): Announcements {
  const title = (id: UniqueIdentifier) => titleOf(String(id));
  const place = (id: UniqueIdentifier) => `position ${order.indexOf(String(id)) + 1} of ${order.length}`;
  return {
    onDragStart: ({ active }) => `Picked up ${title(active.id)}, ${place(active.id)}.`,
    // Fires straight after pick-up too, over the entry's own place.
    onDragOver: ({ active, over }) => {
      if (!over) return `${title(active.id)} is not over the list.`;
      if (over.id === active.id) return `${title(active.id)} is at ${place(over.id)}.`;
      return `${title(active.id)} moved to ${place(over.id)}.`;
    },
    onDragEnd: ({ active, over }) =>
      over ? `${title(active.id)} dropped at ${place(over.id)}.` : `${title(active.id)} dropped where it was.`,
    onDragCancel: ({ active }) => `Move cancelled. ${title(active.id)} stays at ${place(active.id)}.`,
  };
}

/**
 * The handle is a real disabled button only before hydration. While a drop
 * saves it's marked aria-disabled instead (dnd-kit's attributes do that) and
 * won't drag, because a disabled button drops its focus, and a keyboard user
 * who just dropped an entry would lose their place.
 */
function SortableRow(props: { item: QueueItem; place: number; hydrated: boolean; saving: boolean }) {
  const { item, place, hydrated, saving } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.entryId,
    disabled: !hydrated || saving,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 bg-white py-3 dark:bg-black ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${item.title}`}
        disabled={!hydrated}
        className="cursor-grab touch-none rounded px-1 text-lg leading-none text-zinc-500 disabled:cursor-default disabled:opacity-40 aria-disabled:cursor-default aria-disabled:opacity-40"
      >
        ⠿
      </button>
      <span className="w-6 shrink-0 text-right text-sm tabular-nums text-zinc-500">{place}.</span>
      {item.row}
    </li>
  );
}
