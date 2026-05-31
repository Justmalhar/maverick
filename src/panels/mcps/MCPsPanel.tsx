// MCP server list with status dots, start/stop/restart, add-server dialog.
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { mcpList } from "@/lib/tauri";
import { useWorkbench } from "@/state/store";
import type { MCPServer } from "@/lib/ipc";
import MCPServerCard from "./MCPServerCard";
import AddMCPDialog from "./AddMCPDialog";

export default function MCPsPanel() {
  const activeWorkspaceId = useWorkbench((s) => s.activeWorkspaceId);
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const reduce = useReducedMotion();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await mcpList();
      setServers(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <motion.div
      data-testid="mcps-panel"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          MCP Servers
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={refresh} data-testid="mcps-refresh">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddOpen(true)}
            data-testid="mcps-add"
          >
            <Plus className="h-3 w-3" />
            Add MCP
          </Button>
        </div>
      </div>
      {loading && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">Loading…</div>
      )}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>
      )}
      <ScrollArea className="flex-1">
        {servers.length === 0 && !loading ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            No MCP servers configured.
          </div>
        ) : (
          <div className="space-y-1.5 p-2">
            {servers.map((s) => (
              <MCPServerCard
                key={s.name}
                server={s}
                onChange={refresh}
                workspaceId={activeWorkspaceId ?? undefined}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      <AddMCPDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={refresh}
        workspaceId={activeWorkspaceId ?? undefined}
      />
    </motion.div>
  );
}
