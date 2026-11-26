"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { placeUpNext } from "./actions";

export type QueueItem = { entryId: string; title: string; row: ReactNode };

const noSubscription = () => () => {};

/**
 * One Up next queue as a drag-and-drop list. Each row is server-rendered (its
 * buttons work without JavaScript); this adds a drag handle. A drop saves the
 * new place through the placeUpNext action, as "before the next entry". The
 * parent keys this by the queue's order, so a refresh with a new order starts over.
 */
export function SortableQueue({ label, items }: { label: string; items: QueueItem[] }) {
  const [order, setOrder] = useState(items.map((i) => i.entryId));
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

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setOrder(next);
    const moved = String(active.id);
    const form = new FormData();
    form.set("entryId", moved);
    form.set("beforeId", next[next.indexOf(moved) + 1] ?? "");
    startSaving(() => placeUpNext(form));
  }

  return (
    <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol aria-label={label} aria-busy={saving} className="mt-2 flex flex-col divide-y divide-black/10 dark:divide-white/10">
          {order.map((entryId, i) => {
            const item = byId.get(entryId);
            return item ? (
              <SortableRow key={entryId} item={item} place={i + 1} draggable={hydrated && !saving} />
            ) : null;
          })}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ item, place, draggable }: { item: QueueItem; place: number; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.entryId,
    disabled: !draggable,
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
        disabled={!draggable}
        className="cursor-grab touch-none rounded px-1 text-lg leading-none text-zinc-500 disabled:cursor-default disabled:opacity-40"
      >
        ⠿
      </button>
      <span className="w-6 shrink-0 text-right text-sm tabular-nums text-zinc-500">{place}.</span>
      {item.row}
    </li>
  );
}
