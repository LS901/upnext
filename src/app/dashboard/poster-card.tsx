import Link from "next/link";
import { Poster } from "@/components/poster";
import type { MediaType } from "@/lib/providers/types";

/** One card of a poster rail: poster, then a title that clamps, and a line of detail. */
export function PosterCard({
  title,
  imageUrl,
  mediaType,
  detail,
  href,
}: {
  title: string;
  imageUrl: string | null;
  mediaType: MediaType;
  detail: string;
  href: string;
}) {
  return (
    <li className="w-24 shrink-0 sm:w-28">
      <Link href={href} className="flex flex-col gap-2 rounded-lg">
        <Poster url={imageUrl} title={title} size="md" mediaType={mediaType} />
        <span className="line-clamp-3 text-sm font-medium break-words">{title}</span>
        <span className="text-xs break-words text-muted-foreground">{detail}</span>
      </Link>
    </li>
  );
}
