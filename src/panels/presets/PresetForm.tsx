// Per-node config form: terminal (agent, cwd, startup, mode) or browser (url).
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { PresetNode, EditorMode } from "@/lib/ipc";

interface Props {
  node: PresetNode;
  onChange: (next: PresetNode) => void;
}

const AGENTS = ["claude", "codex", "gemini", "amp", "copilot", "opencode", "shell"];

export default function PresetForm({ node, onChange }: Props) {
  if (node.type === "split") {
    return (
      <div className="space-y-2 p-2">
        <div className="text-[11px] text-muted-foreground">Split node — no settings.</div>
        <Input
          type="number"
          step="0.05"
          min={0.1}
          max={0.9}
          value={node.ratio}
          onChange={(e) => onChange({ ...node, ratio: Number(e.target.value) })}
          data-testid="preset-form-ratio"
        />
      </div>
    );
  }

  if (node.type === "browser") {
    return (
      <div className="space-y-2 p-2">
        <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
          URL
        </label>
        <Input
          data-testid="preset-form-url"
          value={node.url ?? ""}
          onChange={(e) => onChange({ ...node, url: e.target.value })}
          placeholder="http://localhost:3000"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onChange({
              type: "terminal",
              agent: "claude",
              cwd: "{{workspace_root}}",
              mode: "agent",
            })
          }
        >
          Convert to terminal
        </Button>
      </div>
    );
  }

  // terminal
  return (
    <div className="space-y-2 p-2">
      <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
        Agent backend
      </label>
      <div className="flex flex-wrap gap-1.5">
        {AGENTS.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={node.agent === a ? "default" : "outline"}
            onClick={() => onChange({ ...node, agent: a })}
            data-testid={`preset-agent-${a}`}
          >
            {a}
          </Button>
        ))}
      </div>

      <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
        Working directory
      </label>
      <Input
        data-testid="preset-form-cwd"
        value={node.cwd}
        onChange={(e) => onChange({ ...node, cwd: e.target.value })}
        placeholder="{{workspace_root}}"
      />

      <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
        Startup command
      </label>
      <Input
        data-testid="preset-form-startup"
        value={node.startup ?? ""}
        onChange={(e) => onChange({ ...node, startup: e.target.value })}
        placeholder="claude --continue"
      />

      <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
        Mode
      </label>
      <div className="flex gap-1.5">
        {(["agent", "terminal"] as EditorMode[]).map((m) => (
          <Button
            key={m}
            size="sm"
            variant={node.mode === m ? "default" : "outline"}
            onClick={() => onChange({ ...node, mode: m })}
            data-testid={`preset-mode-${m}`}
          >
            {m}
          </Button>
        ))}
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange({ type: "browser", url: "http://localhost:3000" })}
      >
        Convert to browser
      </Button>
    </div>
  );
}
