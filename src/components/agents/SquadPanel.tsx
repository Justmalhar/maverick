// Squads: named groups of workspaces with an optional leader, for broadcasting
// one task to several agents at once.
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Pencil, RefreshCw, Radio, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkbench } from "@/state/store";
import { squadList, squadUpsert, squadDelete } from "@/lib/tauri";
import type { Squad } from "@/lib/ipc";
import ProjectFilterTabs from "@/panels/kanban/ProjectFilterTabs";
import SquadDialog from "./SquadDialog";
import SquadBroadcastDialog from "./SquadBroadcastDialog";

function SquadCard({
  squad,
  memberNames,
  leaderName,
  onEdit,
  onBroadcast,
}: {
  squad: Squad;
  memberNames: string[];
  leaderName: string | null;
  onEdit: () => void;
  onBroadcast: () => void;
}) {
  return (
    <li
      data-testid={`squad-card-${squad.id}`}
      className="lift flex items-center gap-2.5 rounded-lg border border-border/50 bg-card/60 px-3 py-2.5 text-xs backdrop-blur-sm hover:border-brand/40"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-foreground">{squad.name}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {leaderName && (
            <span className="inline-flex items-center gap-0.5">
              <Crown className="h-2.5 w-2.5" /> {leaderName} ·{" "}
            </span>
          )}
          {memberNames.length} member{memberNames.length === 1 ? "" : "s"}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-6 gap-1 px-2 text-[11px]"
        onClick={onBroadcast}
        disabled={memberNames.length === 0}
        data-testid={`squad-broadcast-${squad.id}`}
      >
        <Radio className="h-2.5 w-2.5" />
        Broadcast
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        onClick={onEdit}
        aria-label={`Edit ${squad.name}`}
        data-testid={`squad-edit-${squad.id}`}
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </li>
  );
}

export default function SquadPanel() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const projects = useWorkbench((s) => s.projects);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogSquad, setDialogSquad] = useState<Partial<Squad> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [broadcastSquad, setBroadcastSquad] = useState<Squad | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSquads(await squadList(filterProjectId ?? ""));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filterProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const targetProjectId = filterProjectId ?? projects[0]?.id ?? null;
  const projectWorkspaces = (projectId: string | null) =>
    workspaces.filter((w) => w.projectId === projectId);

  function workspaceName(id: string): string {
    return workspaces.find((w) => w.id === id)?.title || workspaces.find((w) => w.id === id)?.branch || id;
  }

  function openNew() {
    if (!targetProjectId) return;
    setDialogSquad({ projectId: targetProjectId, memberWorkspaceIds: [] });
    setDialogOpen(true);
  }

  function openEdit(s: Squad) {
    setDialogSquad(s);
    setDialogOpen(true);
  }

  async function handleSubmit(s: Partial<Squad>) {
    await squadUpsert(s);
    setDialogOpen(false);
    await refresh();
  }

  async function handleDelete(id: string) {
    await squadDelete(id);
    setDialogOpen(false);
    await refresh();
  }

  const reduce = useReducedMotion();

  return (
    <motion.div
      data-testid="squads-panel"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <ProjectFilterTabs filterProjectId={filterProjectId} onFilterChange={setFilterProjectId} />

      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Squads</span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={refresh} data-testid="squad-refresh">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={openNew}
            disabled={!targetProjectId}
            title={!targetProjectId ? "Add a project first" : undefined}
            data-testid="squad-new"
          >
            <Plus className="h-3 w-3" />
            New squad
          </Button>
        </div>
      </div>

      {error && <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>}
      {loading && <div className="px-3 py-1.5 text-[11px] text-muted-foreground">Loading…</div>}

      <ScrollArea className="flex-1">
        {squads.length === 0 && !loading ? (
          <div data-testid="squad-empty" className="px-3 py-2 text-[11px] text-muted-foreground">
            No squads yet — group workspaces to broadcast a task to several agents at once.
          </div>
        ) : (
          <ul className="space-y-1.5 p-2">
            {squads.map((s) => (
              <SquadCard
                key={s.id}
                squad={s}
                memberNames={s.memberWorkspaceIds.map(workspaceName)}
                leaderName={s.leaderWorkspaceId ? workspaceName(s.leaderWorkspaceId) : null}
                onEdit={() => openEdit(s)}
                onBroadcast={() => setBroadcastSquad(s)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      <SquadDialog
        open={dialogOpen}
        squad={dialogSquad ?? undefined}
        projectWorkspaces={projectWorkspaces(dialogSquad?.projectId ?? null)}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
      />

      <SquadBroadcastDialog
        open={broadcastSquad !== null}
        squad={broadcastSquad}
        memberWorkspaces={
          broadcastSquad ? broadcastSquad.memberWorkspaceIds.map((id) => workspaces.find((w) => w.id === id)).filter((w): w is NonNullable<typeof w> => Boolean(w)) : []
        }
        onOpenChange={(o) => !o && setBroadcastSquad(null)}
        onAgentFocus={setActiveWorkspace}
      />
    </motion.div>
  );
}
