"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { quietButton } from "@/app/ui";

/**
 * Submits its form (a server action), disabled while that action saves, so a
 * double-click sends one change. Without JavaScript it's a plain submit button.
 */
export function SubmitButton({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className={`${quietButton} disabled:opacity-40`}>
      {children}
    </button>
  );
}
