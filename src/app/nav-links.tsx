"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Library, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home", icon: Home, match: (path: string) => path === "/" },
  { href: "/search", label: "Search", icon: Search, match: (path: string) => path === "/search" || path.startsWith("/search/") },
  { href: "/library", label: "My library", icon: Library, match: (path: string) => path === "/library" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex lg:sticky lg:top-0 lg:flex-col lg:gap-1 lg:p-3">
      {links.map(({ href, label, icon: Icon, match }) => {
        const current = match(pathname);
        return (
          <li key={href} className="flex-1 lg:flex-none">
            <Link
              href={href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 px-2 text-xs transition-colors duration-150 lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-md lg:px-3 lg:text-sm",
                current
                  ? "font-semibold text-accent-text lg:bg-secondary"
                  : "text-muted-foreground hover:text-foreground lg:hover:bg-secondary",
              )}
            >
              <Icon aria-hidden="true" className="size-5" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
