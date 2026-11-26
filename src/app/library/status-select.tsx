"use client";

import { useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { ENTRY_STATUSES, STATUS_LABELS, type EntryStatus } from "@/lib/library/status";

const noSubscription = () => () => {};

/** Submits its form (the setStatus action) as soon as a new status is picked. */
export function StatusSelect({ status }: { status: EntryStatus }) {
  // Disabled until hydrated, since a change before then wouldn't submit, and
  // while the change is saving.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const { pending } = useFormStatus();

  return (
    <select
      name="status"
      aria-label="Status"
      defaultValue={status}
      disabled={!hydrated || pending}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="rounded-md border border-black/20 bg-transparent px-2 py-1.5 text-sm disabled:opacity-60 dark:border-white/20"
    >
      {ENTRY_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
