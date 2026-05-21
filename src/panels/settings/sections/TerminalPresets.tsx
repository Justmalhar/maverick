// New-tab preset commands per backend (Claude, Codex, Gemini, Amp, Copilot, OpenCode, None + custom).
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface BackendPreset {
  id: string;
  name: string;
  command: string;
  args: string;
  builtin?: boolean;
}

const BUILTINS: BackendPreset[] = [
  { id: "claude", name: "Claude Code", command: "claude", args: "--continue", builtin: true },
  { id: "codex", name: "Codex", command: "codex", args: "", builtin: true },
  { id: "gemini", name: "Gemini", command: "gemini", args: "", builtin: true },
  { id: "amp", name: "Amp", command: "amp", args: "", builtin: true },
  { id: "copilot", name: "Copilot", command: "gh", args: "copilot suggest", builtin: true },
  { id: "opencode", name: "OpenCode", command: "opencode", args: "", builtin: true },
  { id: "shell", name: "None (shell)", command: "$SHELL", args: "", builtin: true },
];

export default function TerminalPresets() {
  const [presets, setPresets] = useState<BackendPreset[]>(BUILTINS);

  const update = (id: string, patch: Partial<BackendPreset>) =>
    setPresets((curr) => curr.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const remove = (id: string) =>
    setPresets((curr) => curr.filter((p) => p.id !== id));

  const add = () => {
    const id = `custom-${presets.length + 1}`;
    setPresets((curr) => [...curr, { id, name: id, command: "", args: "" }]);
  };

  return (
    <section data-testid="terminal-presets" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Terminal presets</h3>
        <Button size="sm" variant="outline" onClick={add} data-testid="terminal-add">
          <Plus className="h-3 w-3" /> Custom
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {presets.map((p) => (
          <div
            key={p.id}
            data-testid={`terminal-preset-${p.id}`}
            className="rounded-sm border border-border bg-card/30 p-2"
          >
            <div className="mb-1.5 flex items-center justify-between">
              <Input
                value={p.name}
                onChange={(e) => update(p.id, { name: e.target.value })}
                disabled={p.builtin}
                className="max-w-[160px]"
              />
              {!p.builtin && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => remove(p.id)}
                  data-testid="terminal-remove"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
              Command
            </label>
            <Input
              value={p.command}
              onChange={(e) => update(p.id, { command: e.target.value })}
            />
            <label className="mt-1.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
              Args
            </label>
            <Input value={p.args} onChange={(e) => update(p.id, { args: e.target.value })} />
          </div>
        ))}
      </div>
    </section>
  );
}
