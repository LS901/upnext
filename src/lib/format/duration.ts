/** "2 h 5 min", "45 min" or "12 h", rounded to the minute; null is "unknown". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "unknown";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
