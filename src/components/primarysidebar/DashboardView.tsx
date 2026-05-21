import { useWorkbench } from "@/state/store";

export function DashboardView() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const totalCost = 0;

  return (
    <div
      data-testid="dashboard-view"
      className="flex flex-col gap-4 overflow-auto px-3 py-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Session cost" value={`$${totalCost.toFixed(2)}`} />
        <StatCard label="Workspaces" value={String(workspaces.length)} />
      </div>

    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border-glass bg-card px-2.5 py-2">
      <span className="text-[10px] uppercase tracking-wider text-sidebar-section">{label}</span>
      <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}
