import Image from "next/image";
import { Film, Gamepad2, Tv } from "lucide-react";
import type { MediaType } from "@/lib/providers/types";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const DIMENSIONS: Record<Size, { width: number; height: number }> = {
  sm: { width: 48, height: 72 },
  md: { width: 80, height: 120 },
  lg: { width: 120, height: 180 },
};

const ICONS = { movie: Film, show: Tv, game: Gamepad2 } as const;

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}

/** A poster or cover. Decorative: the title is always shown as text beside it. */
export function Poster({
  url,
  title,
  size,
  mediaType,
  className,
}: {
  url: string | null;
  title: string;
  size: Size;
  mediaType: MediaType;
  className?: string;
}) {
  const { width, height } = DIMENSIONS[size];
  const style = { width, height };

  if (!url) {
    const Icon = ICONS[mediaType];
    return (
      <div
        aria-hidden="true"
        style={style}
        className={cn(
          "flex shrink-0 flex-col items-center justify-center gap-1 rounded-sm bg-secondary text-muted-foreground transition-[transform,color,background-color,border-color] duration-150 hover:-translate-y-0.5",
          className,
        )}
      >
        <Icon className={size === "sm" ? "size-4" : "size-6"} />
        <span className={cn("font-semibold", size === "sm" ? "text-xs" : "text-sm")}>{initials(title)}</span>
      </div>
    );
  }

  return (
    <Image
      src={url}
      alt=""
      width={width}
      height={height}
      unoptimized
      style={style}
      className={cn(
        "shrink-0 rounded-sm object-cover transition-[transform,color,background-color,border-color] duration-150 hover:-translate-y-0.5",
        className,
      )}
    />
  );
}
