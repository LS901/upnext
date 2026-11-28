import Link from "next/link";
import { TAB_LABELS, TAB_TYPES, type TabType } from "@/lib/library/type-filter";
import { cn } from "@/lib/utils";

/**
 * Type tabs as plain links, so they work without JavaScript: the current one
 * carries aria-current="page". The page decides where each tab goes.
 */
export function TypeTabs({
  current,
  counts,
  hrefFor,
}: {
  current: TabType;
  counts: Record<TabType, number>;
  hrefFor: (type: TabType) => string;
}) {
  return (
    <nav aria-label="Type">
      <ul className="flex flex-wrap gap-2">
        {TAB_TYPES.map((type) => (
          <li key={type}>
            <Link
              href={hrefFor(type)}
              aria-current={type === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-9",
                type === current ? "bg-foreground text-background" : "text-foreground hover:bg-muted",
              )}
            >
              {TAB_LABELS[type]} ({counts[type]})
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
