export function StatTile({ label, value, detail }: { label: string; value: number; detail?: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      <p className="text-sm font-medium">{label}</p>
      {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
