"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { quietButton } from "@/app/ui";

/**
 * Submits its form (a server action). While that action saves, or when its
 * caller disables it, it's marked aria-disabled and ignores clicks, so a
 * double-click sends one change. Not the disabled attribute: a disabled button
 * drops its focus, and a keyboard user pressing Move up would lose their place.
 * Before hydration it's a plain submit button, so a caller that disables it must
 * also make its form harmless to send (the Move buttons post a no-op target).
 */
export function SubmitButton({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const off = disabled || pending;
  return (
    <button
      type="submit"
      aria-disabled={off}
      onClick={(e) => {
        if (off) e.preventDefault();
      }}
      className={`${quietButton} aria-disabled:cursor-default aria-disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
