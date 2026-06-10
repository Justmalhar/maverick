import { useState, useMemo, useEffect } from "react";
import { Play, Wrench, FolderPlus, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { useScriptRunner } from "@/hooks/useScriptRunner";
import { PanelTabs, type BottomPanelTab } from "./PanelTabs";

interface EmptyProps {
  icon: typeof Play;
  title: string;
  hint: string;
  ctaLabel: string;
  onCta: () => void;
}

function EmptyState({ icon: Icon, title, hint, ctaLabel, onCta }: EmptyProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-[13px] text-foreground">{title}</span>
      <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
      <button
        type="button"
        onClick={onCta}
        className="mt-1 rounded-md border border-dashed border-border bg-card/30 px-4 py-2 text-[12px] text-foreground hover:bg-card/60"
      >
        <FolderPlus className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
        {ctaLabel}
      </button>
    </div>
  );
}

function ScriptPane({ kind }: { kind: "setup" | "run" }) {
  const activeWs = useWorkbench(selectActiveWorkspace);
  const settings = useProjectSettingsStore((s) => s.data);
  const settingsProjectId = useProjectSettingsStore((s) => s.projectId);
  const settingsStatus = useProjectSettingsStore((s) => s.status);
  const openProjectSettings = useWorkbench((s) => s.openProjectSettings);
  const pendingSetupIds = useWorkbench((s) => s.pendingSetupIds);
  const clearPendingSetup = useWorkbench((s) => s.clearPendingSetup);

  const script = useMemo(() => settings?.scripts?.[kind] ?? "", [settings, kind]);
  const runner = useScriptRunner(activeWs?.id ?? null, activeWs?.worktreePath ?? null, script);

  // Auto-run setup for freshly created workspaces. Wait until the loaded
  // settings belong to THIS workspace's project so a stale store can't run the
  // previous project's script in the new worktree.
  const pending = kind === "setup" && !!activeWs && pendingSetupIds.includes(activeWs.id);
  const settingsReady =
    settingsStatus === "loaded" && settingsProjectId === activeWs?.projectId;
  const { start } = runner;
  useEffect(() => {
    if (!pending || !settingsReady || !activeWs) return;
    clearPendingSetup(activeWs.id);
    if (script.trim()) void start();
  }, [pending, settingsReady, activeWs, script, start, clearPendingSetup]);

  if (!activeWs) {
    return (
      <EmptyState
        icon={kind === "setup" ? Wrench : Play}
        title={kind === "setup" ? "Setup" : "Run"}
        hint="Open a workspace from a project to configure setup and run scripts."
        ctaLabel="Open Project Settings"
        onCta={() => { /* no project context */ }}
      />
    );
  }

  if (!script.trim()) {
    return (
      <EmptyState
        icon={kind === "setup" ? Wrench : Play}
        title={kind === "setup" ? "Setup" : "Run"}
        hint={kind === "setup"
          ? "Run commands when a workspace is created to install dependencies or set up the environment."
          : "Run a dev server or test runner to verify changes in this workspace."}
        ctaLabel={kind === "setup" ? "Add setup script" : "Add run script"}
        onCta={() => openProjectSettings({ projectId: activeWs.projectId, initialSection: "scripts", focusField: kind })}
      />
    );
  }

  return (
    <div data-testid={`panel-${kind}-content`} className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
        <button
          type="button"
          onClick={runner.state === "running" ? () => void runner.stop() : () => void runner.start()}
          className="inline-flex items-center gap-1.5 rounded-md bg-sidebar-hover px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          {runner.state === "running"
            ? <><StopCircle className="h-3 w-3 text-destructive" /> Stop</>
            : <><Play className="h-3 w-3" /> {kind === "setup" ? "Run setup" : "Run"}</>}
        </button>
        <span className="truncate font-mono text-[11px]">{script}</span>
      </div>
      <pre
        className={cn(
          "flex-1 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px]",
          runner.state === "exited" && runner.exitCode !== 0 && "text-destructive"
        )}
      >
        {runner.output || (runner.state === "idle" ? "Click Run to start." : "")}
      </pre>
      {runner.state === "exited" && runner.exitCode !== 0 && (
        <div className="border-t border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          Exited {runner.exitCode}. <button type="button" onClick={() => void runner.start()} className="underline">Retry</button>
        </div>
      )}
    </div>
  );
}

export function Panel({ collapsed = false }: { collapsed?: boolean }) {
  const [tab, setTab] = useState<BottomPanelTab>("setup");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "setup" || detail === "run") {
        setTab(detail);
      }
    };
    window.addEventListener("maverick:panel:tab", handler);
    return () => window.removeEventListener("maverick:panel:tab", handler);
  }, []);

  return (
    <section
      data-testid="bottom-panel"
      className={cn("mv-panel flex w-full flex-col bg-sidebar", collapsed ? "shrink-0" : "h-full")}
      style={{ borderTop: "1px solid hsl(var(--border))" }}
    >
      <PanelTabs value={tab} onChange={setTab} />
      {!collapsed && (
        <div className="flex-1 overflow-hidden">
          {tab === "setup" && <ScriptPane kind="setup" />}
          {tab === "run" && <ScriptPane kind="run" />}
        </div>
      )}
    </section>
  );
}
