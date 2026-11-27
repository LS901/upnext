import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  text,
  action,
}: {
  icon: LucideIcon;
  text: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <Icon aria-hidden="true" className="size-8 text-muted-foreground" />
      <p className="text-muted-foreground">{text}</p>
      {action ? (
        <Link href={action.href} className={cn(buttonVariants())}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
