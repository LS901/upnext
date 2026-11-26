"use client";

import { useSyncExternalStore } from "react";
import { quietButton } from "@/app/ui";
import { QUEUE_LABELS, QUEUE_TYPES, type QueueType } from "@/lib/library/up-next-order";
import { setUpNextVisibility } from "./actions";

const noSubscription = () => () => {};

/**
 * The "Show" checkboxes above the Up next queues. With JavaScript a tick saves
 * at once; without it, the Update button submits the form.
 */
export function QueueVisibility({ hidden }: { hidden: QueueType[] }) {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return (
    <form action={setUpNextVisibility} className="mt-3 flex flex-wrap items-center gap-4 text-sm">
      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="float-left mr-1 font-medium">Show</legend>
        {QUEUE_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="show"
              value={type}
              defaultChecked={!hidden.includes(type)}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            {QUEUE_LABELS[type]}
          </label>
        ))}
      </fieldset>
      {!hydrated && (
        <button type="submit" className={quietButton}>
          Update
        </button>
      )}
    </form>
  );
}
