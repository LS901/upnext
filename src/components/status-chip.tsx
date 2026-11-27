import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type EntryStatus } from "@/lib/library/status";

const DOT: Record<EntryStatus, string> = {
  backlog: "bg-muted-foreground",
  in_progress: "bg-primary",
  finished: "bg-emerald-400",
  paused: "bg-amber-400",
  dropped: "bg-rose-400",
};

/** The status as text; the dot is decoration, so colour never carries it alone. */
export function StatusChip({ status }: { status: EntryStatus }) {
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT[status]}`} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}
