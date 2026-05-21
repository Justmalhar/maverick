// Per-repo config: worktrees path, base branch, scripts, AI preferences, instructions file.
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Project } from "@/lib/ipc";

interface Props {
  project: Project;
}

interface RepoConfigState {
  worktreesPath: string;
  baseBranch: string;
  runScript: string;
  setupScript: string;
  testScript: string;
  defaultBackend: string;
  instructionsFile: string;
  instructions: string;
}

const INITIAL: RepoConfigState = {
  worktreesPath: ".maverick/worktrees",
  baseBranch: "origin/main",
  runScript: "bun run dev",
  setupScript: "bun install",
  testScript: "bun test",
  defaultBackend: "claude",
  instructionsFile: "MAVERICK.md",
  instructions: "",
};

export default function RepoConfig({ project }: Props) {
  const [state, setState] = useState<RepoConfigState>(INITIAL);

  // Reset to defaults whenever a different repo is selected. Backend persistence is a v0.2 concern.
  useEffect(() => {
    setState(INITIAL);
  }, [project.id]);

  const update = <K extends keyof RepoConfigState>(key: K, value: RepoConfigState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  return (
    <div data-testid="repo-config" className="space-y-3">
      <header>
        <h3 className="text-sm font-medium text-foreground">{project.name}</h3>
        <p className="font-mono text-[10px] text-muted-foreground">{project.path}</p>
      </header>

      <Tabs defaultValue="paths">
        <TabsList>
          <TabsTrigger value="paths" data-testid="repo-tab-paths">Paths</TabsTrigger>
          <TabsTrigger value="scripts" data-testid="repo-tab-scripts">Scripts</TabsTrigger>
          <TabsTrigger value="ai" data-testid="repo-tab-ai">AI</TabsTrigger>
          <TabsTrigger value="instructions" data-testid="repo-tab-instructions">
            Instructions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="paths" className="space-y-2 py-2">
          <Field label="Worktrees path">
            <Input
              data-testid="repo-worktrees"
              value={state.worktreesPath}
              onChange={(e) => update("worktreesPath", e.target.value)}
            />
          </Field>
          <Field label="Branch new workspaces from">
            <Input
              data-testid="repo-base-branch"
              value={state.baseBranch}
              onChange={(e) => update("baseBranch", e.target.value)}
            />
          </Field>
        </TabsContent>

        <TabsContent value="scripts" className="space-y-2 py-2">
          <Field label="Setup script">
            <Input
              data-testid="repo-setup"
              value={state.setupScript}
              onChange={(e) => update("setupScript", e.target.value)}
            />
          </Field>
          <Field label="Run script">
            <Input
              data-testid="repo-run"
              value={state.runScript}
              onChange={(e) => update("runScript", e.target.value)}
            />
          </Field>
          <Field label="Test script">
            <Input
              data-testid="repo-test"
              value={state.testScript}
              onChange={(e) => update("testScript", e.target.value)}
            />
          </Field>
        </TabsContent>

        <TabsContent value="ai" className="space-y-2 py-2">
          <Field label="Default backend for this repo">
            <Input
              data-testid="repo-backend"
              value={state.defaultBackend}
              onChange={(e) => update("defaultBackend", e.target.value)}
            />
          </Field>
        </TabsContent>

        <TabsContent value="instructions" className="space-y-2 py-2">
          <Field label="Instructions file">
            <Input
              data-testid="repo-instructions-file"
              value={state.instructionsFile}
              onChange={(e) => update("instructionsFile", e.target.value)}
            />
          </Field>
          <Field label={`Instructions (${state.instructions.length} chars)`}>
            <textarea
              data-testid="repo-instructions"
              value={state.instructions}
              onChange={(e) => update("instructions", e.target.value)}
              rows={10}
              className="w-full resize-none rounded-sm border border-border bg-input p-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Field>
          {state.instructions.length > 16000 && (
            <p className="text-[10px] text-warning">
              Warning: file may consume significant context budget.
            </p>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button size="sm" data-testid="repo-save">
          Save changes
        </Button>
      </div>
    </div>
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
