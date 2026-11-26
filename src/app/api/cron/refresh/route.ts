import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { refreshStaleItems } from "@/lib/catalogue/refresh";

// Called by the scheduler (and `npm run refresh` locally) with
// `Authorization: Bearer ${CRON_SECRET}`. Anything else gets a 401 before any
// work is done.
export async function POST(request: Request): Promise<Response> {
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { refreshed, failed, purged, pruned } = await refreshStaleItems();
  return Response.json({ refreshed, failed, purged, pruned });
}

function authorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  // Compare fixed-length digests so the check takes the same time either way.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
