"use client";

import { useFormStatus } from "react-dom";
import { quietButton } from "@/app/ui";

/** Submits its form (the removeEntry action); disabled while the remove is saving. */
export function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${quietButton} disabled:opacity-60`}>
      Remove
    </button>
  );
}
