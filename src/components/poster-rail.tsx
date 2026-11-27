import type { ReactNode } from "react";

/** A row of poster cards: scrolls inside itself on phones, wraps as a grid from lg. */
export function PosterRail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul
      aria-label={label}
      className="-m-1 flex gap-4 overflow-x-auto p-1 pb-3 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] lg:overflow-visible"
    >
      {children}
    </ul>
  );
}
