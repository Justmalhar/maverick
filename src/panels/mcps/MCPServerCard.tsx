// Single MCP server card: status dot + start / stop / restart + logs viewer.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MCPServer } from "@/lib/ipc";
import { mcpLogs, mcpStart, mcpStop, onMcpStatus } from "@/lib/tauri";

interface Props {
  server: MCPServer;
  onChange: () => void;
  // Active workspace; lets the sidecar resolve the project's MCP config.
  workspaceId?: string;
}

// MCP statuses (running/stopped/error/crashed/restarting) collapse onto the
// shared StatusDot palette: a crash reuses the error red, a pending restart the
// warning amber, everything else maps to its like-named variant.
function dotVariant(status: MCPServer["status"]): "running" | "stopped" | "error" | "warning" {
  switch (status) {
    case "running":
      return "running";
    case "crashed":
    case "error":
      return "error";
    case "restarting":
      return "warning";
    default:
      return "stopped";
  }
}

export default function MCPServerCard({ server, onChange, workspaceId }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logText, setLogText] = useState("");
  const offsetRef = useRef(0);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await mcpStart(server.name, workspaceId);
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await mcpStop(server.name);
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    setError(null);
    try {
      await mcpStop(server.name);
      await mcpStart(server.name, workspaceId);
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Page the bounded ring by offset: each fetch advances the cursor and appends
  // only the new tail, so a long-lived server's logs stream without re-reading.
  const pollLogs = useCallback(async () => {
    try {
      const page = await mcpLogs(server.name, offsetRef.current);
      offsetRef.current = page.nextOffset;
      if (page.data) setLogText((prev) => (prev + page.data).slice(-64_000));
    } catch (e) {
      setError(String(e));
    }
  }, [server.name]);

  useEffect(() => {
    if (!logsOpen) return;
    pollLogs();
    const id = setInterval(pollLogs, 1_000);
    return () => clearInterval(id);
  }, [logsOpen, pollLogs]);

  // An auto-restart/crash arrives as a sidecar event, not a poll — refresh the
  // list so the parent re-renders this card with the new status + restart count.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onMcpStatus((payload) => {
      if (payload.name === server.name) onChange();
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {
        /* event channel not registered — fine */
      });
    return () => {
      unlisten?.();
    };
  }, [server.name, onChange]);

  return (
    <div
      data-testid="mcp-server-card"
      className="flex flex-col gap-2 rounded-sm border border-border bg-card/40 p-2"
    >
      <div className="flex items-center gap-2">
        <StatusDot variant={dotVariant(server.status)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs text-foreground">{server.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {server.status}
            </span>
            {server.restarts != null && server.restarts > 0 && (
              <span className="text-[10px] text-warning" data-testid="mcp-restart-count">
                ↻{server.restarts}
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {server.command} {server.args.join(" ")}
          </div>
          {server.pid && (
            <div className="text-[10px] text-muted-foreground">pid {server.pid}</div>
          )}
          {error && <div className="text-[10px] text-destructive">{error}</div>}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy || server.status === "running"}
          onClick={start}
          data-testid="mcp-start"
        >
          <Play className="h-3 w-3" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy || server.status !== "running"}
          onClick={stop}
          data-testid="mcp-stop"
        >
          <Pause className="h-3 w-3" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          onClick={restart}
          data-testid="mcp-restart"
        >
          <RotateCw className="h-3 w-3" />
        </Button>
        <Button
          size="icon-sm"
          variant={logsOpen ? "secondary" : "ghost"}
          onClick={() => setLogsOpen((o) => !o)}
          data-testid="mcp-logs-toggle"
          aria-pressed={logsOpen}
        >
          <ScrollText className="h-3 w-3" />
        </Button>
      </div>
      {logsOpen && (
        <ScrollArea
          className="max-h-40 rounded-sm border border-border bg-background"
          data-testid="mcp-logs"
        >
          {logText ? (
            <pre className="whitespace-pre-wrap p-2 font-mono text-[10px] text-muted-foreground">
              {logText}
            </pre>
          ) : (
            <div className="p-2 font-mono text-[10px] text-muted-foreground">No output yet.</div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
