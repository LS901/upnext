import { StatTile } from "@/components/stat-tile";
import { timeLeftLabel, type DashboardStats } from "@/lib/library/dashboard-summary";

export function Numbers({ stats }: { stats: DashboardStats }) {
  return (
    <section aria-label="Your numbers" className="grid grid-cols-3 gap-2 sm:gap-4">
      <StatTile label="Backlog" value={stats.backlog} detail={timeLeftLabel(stats.backlogMinutes, stats.backlogUnknownTime)} />
      <StatTile label="In progress" value={stats.inProgress} />
      <StatTile label="Finished" value={stats.finished} />
    </section>
  );
}
