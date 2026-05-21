// Single MCP server card: status dot + start / stop / restart buttons.
import { useState } from "react";
import { Pause, Play, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { MCPServer } from "@/lib/ipc";
import { mcpStart, mcpStop } from "@/lib/tauri";

interface Props {
  server: MCPServer;
  onChange: () => void;
}

export default function MCPServerCard({ server, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await mcpStart(server.name);
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
      await mcpStart(server.name);
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const variant: "running" | "stopped" | "error" =
    server.status === "running" ? "running" : server.status === "error" ? "error" : "stopped";

  return (
    <div
      data-testid="mcp-server-card"
      className="flex items-center gap-2 rounded-sm border border-border bg-card/40 p-2"
    >
      <StatusDot variant={variant} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-foreground">{server.name}</div>
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
    </div>
  );
}
