"use client";

import { useSyncExternalStore } from "react";
import { buttonVariants } from "@/components/ui/button";
import { QUEUE_LABELS, QUEUE_TYPES, type QueueType } from "@/lib/library/up-next-order";
import { cn } from "@/lib/utils";
import { setUpNextVisibility } from "./actions";

const noSubscription = () => () => {};

/**
 * The "Show" checkboxes above the Up next queues, each with how many entries
 * its queue holds, so a hidden queue still shows what's in it. With JavaScript
 * a tick saves at once; without it, the Update button submits the form.
 */
export function QueueVisibility({ hidden, counts }: { hidden: QueueType[]; counts: Record<QueueType, number> }) {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return (
    <form action={setUpNextVisibility} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <fieldset className="flex min-w-0 flex-wrap items-center gap-2">
        <legend className="float-left mr-1 font-medium text-muted-foreground">Show</legend>
        {QUEUE_TYPES.map((type) => (
          <label
            key={type}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-input bg-secondary px-4 transition-[transform,color,background-color,border-color] duration-150 hover:bg-muted has-checked:border-primary has-checked:bg-primary/20 lg:min-h-9"
          >
            <input
              type="checkbox"
              className="size-4 accent-primary"
              name="show"
              value={type}
              defaultChecked={!hidden.includes(type)}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            {QUEUE_LABELS[type]} ({counts[type]})
          </label>
        ))}
      </fieldset>
      {!hydrated && (
        <button type="submit" className={cn(buttonVariants({ variant: "secondary" }))}>
          Update
        </button>
      )}
    </form>
  );
}
