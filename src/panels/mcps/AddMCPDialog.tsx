// Add new MCP server — name, command, args (chip input), env vars + presets.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { mcpAdd } from "@/lib/tauri";
import { MCP_PRESETS, type MCPPreset } from "./presets";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  // Active workspace; lets the sidecar resolve the project's maverick.yaml so
  // the new server persists into config.
  workspaceId?: string;
}

interface EnvPair {
  key: string;
  value: string;
}

export default function AddMCPDialog({ open, onOpenChange, onAdded, workspaceId }: Props) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argInput, setArgInput] = useState("");
  const [args, setArgs] = useState<string[]>([]);
  const [envKey, setEnvKey] = useState("");
  const [envValue, setEnvValue] = useState("");
  const [env, setEnv] = useState<EnvPair[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setCommand("");
      setArgInput("");
      setArgs([]);
      setEnvKey("");
      setEnvValue("");
      setEnv([]);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const addArg = () => {
    const t = argInput.trim();
    if (!t) return;
    setArgs([...args, t]);
    setArgInput("");
  };

  const addEnv = () => {
    if (!envKey.trim()) return;
    setEnv([...env, { key: envKey.trim(), value: envValue }]);
    setEnvKey("");
    setEnvValue("");
  };

  const applyPreset = (preset: MCPPreset) => {
    setName(preset.name);
    setCommand(preset.command);
    setArgs(preset.args);
    setArgInput("");
    setEnv(Object.entries(preset.env ?? {}).map(([key, value]) => ({ key, value })));
    setError(null);
  };

  const submit = async () => {
    if (!name.trim() || !command.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const envObj = env.reduce<Record<string, string>>((acc, p) => {
        acc[p.key] = p.value;
        return acc;
      }, {});
      await mcpAdd(name.trim(), command.trim(), args, envObj, workspaceId);
      onAdded();
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-mcp-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            Configure a Model Context Protocol server that AI backends can call.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Field label="Presets">
            <div className="flex flex-wrap gap-1" data-testid="mcp-presets">
              {MCP_PRESETS.map((p) => (
                <Badge
                  key={p.id}
                  variant="outline"
                  className="cursor-pointer"
                  title={p.description}
                  data-testid={`mcp-preset-${p.id}`}
                  onClick={() => applyPreset(p)}
                >
                  {p.name}
                </Badge>
              ))}
            </div>
          </Field>
          <Field label="Name">
            <Input
              data-testid="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="filesystem"
              autoFocus
            />
          </Field>
          <Field label="Command">
            <Input
              data-testid="mcp-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
            />
          </Field>

          <Field label="Arguments">
            <div className="flex gap-2">
              <Input
                data-testid="mcp-arg-input"
                value={argInput}
                onChange={(e) => setArgInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addArg())}
                placeholder="-y, @modelcontextprotocol/server-filesystem"
              />
              <Button size="sm" variant="outline" onClick={addArg}>
                Add
              </Button>
            </div>
            {args.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {args.map((a, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => setArgs(args.filter((_, j) => j !== i))}
                  >
                    {a} <X className="ml-1 inline h-2.5 w-2.5" />
                  </Badge>
                ))}
              </div>
            )}
          </Field>

          <Field label="Environment variables">
            <div className="flex gap-2">
              <Input
                data-testid="mcp-env-key"
                value={envKey}
                onChange={(e) => setEnvKey(e.target.value)}
                placeholder="API_KEY"
              />
              <Input
                data-testid="mcp-env-value"
                value={envValue}
                onChange={(e) => setEnvValue(e.target.value)}
                placeholder="…"
              />
              <Button size="sm" variant="outline" onClick={addEnv}>
                Add
              </Button>
            </div>
            {env.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {env.map((p, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => setEnv(env.filter((_, j) => j !== i))}
                  >
                    {p.key}=•••
                  </Badge>
                ))}
              </div>
            )}
          </Field>

          {error && <div className="text-[11px] text-destructive">{error}</div>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || !command.trim() || busy}
            onClick={submit}
            data-testid="mcp-add-submit"
          >
            Add server
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
