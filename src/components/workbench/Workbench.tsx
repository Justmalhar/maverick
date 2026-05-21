import { Suspense, lazy } from "react";
import { useWorkbench } from "@/state/store";
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

const PresetPicker = lazy(() => import("@/panels/presets/PresetPicker"));
const SettingsPanel = lazy(() => import("@/panels/settings/SettingsPanel"));

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

  return (
    <div
      data-testid="workbench"
      className="mv-workbench relative flex h-screen w-screen flex-col overflow-hidden bg-titlebar text-foreground"
    >
      <TitleBar />

      <div className="flex flex-1 overflow-hidden border-t border-border-glass">
        <ResizablePanelGroup direction="horizontal" className="h-full flex-1">
          {layout.primarySideBarVisible && (
            <>
              <ResizablePanel
                defaultSize={20}
                minSize={14}
                maxSize={36}
                data-testid="primarysidebar-panel"
                className="bg-sidebar"
              >
                <PrimarySideBar />
              </ResizablePanel>
              <ResizableHandle className="!w-px !bg-border-glass" />
            </>
          )}

          <ResizablePanel defaultSize={layout.auxiliaryBarVisible ? 58 : 82} className="bg-editor">
            <EditorArea />
          </ResizablePanel>

          {layout.auxiliaryBarVisible && (
            <>
              <ResizableHandle className="!w-px !bg-border-glass" />
              <ResizablePanel
                defaultSize={22}
                minSize={14}
                maxSize={36}
                data-testid="auxiliarybar-panel"
                className="bg-sidebar"
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
    </div>
  );
}
