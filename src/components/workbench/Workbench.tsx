import { Suspense, lazy, useEffect } from "react";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { onProjectSettingsChanged } from "@/lib/tauri";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { TitleBar } from "@/components/titlebar/TitleBar";
import { PrimarySideBar } from "@/components/primarysidebar/PrimarySideBar";
import { AuxiliaryBar } from "@/components/auxiliarybar/AuxiliaryBar";
import { EditorArea } from "@/components/editor/EditorArea";
import { QuickOpen } from "@/components/quickopen/QuickOpen";
import { CommandPalette } from "@/components/quickopen/CommandPalette";
import { Toaster } from "@/components/notifications/Toaster";

const PresetPicker = lazy(() => import("@/panels/presets/PresetPicker"));
const SettingsPanel = lazy(() => import("@/panels/settings/SettingsPanel"));
const ProjectSettingsPanel = lazy(() => import("@/panels/project-settings/ProjectSettingsPanel"));
const FirstRunWizard = lazy(() =>
  import("@/panels/firstrun/FirstRunWizard").then((m) => ({ default: m.FirstRunWizard }))
);

function OverlayFallback() {
  return null;
}

// Warp-style: one unified tinted background, panels flush edge-to-edge,
// 1px white-overlay separators where they meet. No floating cards.
export function Workbench() {
  const layout = useWorkbench((s) => s.layout);
  const presetLauncherOpen = useWorkbench((s) => s.presetLauncherOpen);
  const setPresetLauncherOpen = useWorkbench((s) => s.setPresetLauncherOpen);
  const settingsOpen = useWorkbench((s) => s.settingsOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const projectSettingsState = useWorkbench((s) => s.projectSettings);
  const closeProjectSettings = useWorkbench((s) => s.closeProjectSettings);
  const activeWsProjectId = useWorkbench((s) => {
    const ws = s.activeWorkspaceId ? s.workspaces.find((w) => w.id === s.activeWorkspaceId) : null;
    return ws?.projectId ?? null;
  });
  const loadProjectSettings = useProjectSettingsStore((s) => s.load);
  const { refreshProjects, refreshWorkspaces, refreshBackends } = useWorkspace();

  useEffect(() => {
    refreshProjects().catch((e) => console.error("refreshProjects failed", e));
    refreshWorkspaces().catch((e) => console.error("refreshWorkspaces failed", e));
    refreshBackends().catch((e) => console.error("refreshBackends failed", e));
  }, [refreshProjects, refreshWorkspaces, refreshBackends]);

  useEffect(() => {
    if (activeWsProjectId) {
      void loadProjectSettings(activeWsProjectId);
    }
  }, [activeWsProjectId, loadProjectSettings]);

  useEffect(() => {
    const offPromise = onProjectSettingsChanged(({ projectId, settings }) => {
      const cur = useProjectSettingsStore.getState();
      if (cur.projectId !== projectId) return;
      if (Object.keys(cur.dirty).length > 0) {
        console.warn("project settings changed on disk while editing — keep editing wins on next save");
        return;
      }
      useProjectSettingsStore.setState({ data: settings });
    });
    return () => { void offPromise.then((fn) => fn()); };
  }, []);

  return (
    <div
      data-testid="workbench"
      className="mv-workbench relative flex h-screen w-screen flex-col overflow-hidden bg-titlebar text-foreground"
    >
      <TitleBar />

      <div className="flex flex-1 overflow-hidden" style={{ borderTop: "1px solid hsl(var(--border))" }}>
        <ResizablePanelGroup direction="horizontal" className="h-full flex-1">
          {layout.primarySideBarVisible && (
            <>
              <ResizablePanel
                defaultSize={15}
                minSize={11}
                maxSize={30}
                data-testid="primarysidebar-panel"
                className="bg-sidebar"
              >
                <PrimarySideBar />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          <ResizablePanel defaultSize={layout.auxiliaryBarVisible ? 63 : 85} className="bg-editor" style={{ borderLeft: "1px solid hsl(var(--border))" }}>
            <EditorArea />
          </ResizablePanel>

          {layout.auxiliaryBarVisible && (
            <>
              <ResizableHandle />
              <ResizablePanel
                defaultSize={22}
                minSize={14}
                maxSize={36}
                data-testid="auxiliarybar-panel"
                className="bg-sidebar"
                style={{ borderLeft: "1px solid hsl(var(--border))" }}
              >
                <AuxiliaryBar />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <QuickOpen />
      <CommandPalette />

      <Suspense fallback={<OverlayFallback />}>
        <PresetPicker
          open={presetLauncherOpen}
          onOpenChange={setPresetLauncherOpen}
        />
      </Suspense>

      {settingsOpen && (
        <Suspense fallback={<OverlayFallback />}>
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}

      {projectSettingsState.open && (
        <Suspense fallback={<OverlayFallback />}>
          <ProjectSettingsPanel
            open
            projectId={projectSettingsState.projectId}
            initialSection={projectSettingsState.initialSection}
            onOpenChange={(o) => !o && closeProjectSettings()}
          />
        </Suspense>
      )}

      <Suspense fallback={<OverlayFallback />}>
        <FirstRunWizard />
      </Suspense>

      <Toaster />
    </div>
  );
}
