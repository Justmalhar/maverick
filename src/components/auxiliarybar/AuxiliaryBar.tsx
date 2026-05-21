import { useWorkbench } from "@/state/store";
import type { AuxiliaryView } from "@/lib/ipc";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Panel } from "@/components/panel/Panel";
import { FilesView } from "./FilesView";
import { DiffView } from "./DiffView";

const TABS: Array<{ value: AuxiliaryView; label: string }> = [
  { value: "files", label: "Files" },
  { value: "diff", label: "Changes" },
  { value: "preview", label: "Checks" },
];

export function AuxiliaryBar() {
  const auxView = useWorkbench((s) => s.layout.auxiliaryView);
  const setAuxView = useWorkbench((s) => s.setAuxiliaryView);
  const panelVisible = useWorkbench((s) => s.layout.panelVisible);

  return (
    <aside
      data-testid="auxiliary-bar"
      className="mv-auxiliarybar flex h-full w-full flex-col bg-sidebar text-sidebar-fg"
    >
      <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={panelVisible ? 60 : 100} minSize={20}>
          <Tabs
            value={auxView}
            onValueChange={(v) => setAuxView(v as AuxiliaryView)}
            className="flex h-full flex-col"
          >
            <TabsList
              className="shrink-0 border-b border-border-glass"
              style={{ height: "var(--panel-tabs-height)" }}
            >
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} data-testid={`aux-tab-${t.value}`}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="files" className="flex-1 overflow-hidden">
              <FilesView />
            </TabsContent>
            <TabsContent value="diff" className="flex-1 overflow-hidden">
              <DiffView />
            </TabsContent>
            <TabsContent value="preview" className="flex-1 overflow-hidden">
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
                <span className="text-foreground">No checks configured</span>
                <p className="max-w-xs">
                  Run your test suite or linter to see pass/fail summaries here.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </ResizablePanel>

        {panelVisible && (
          <>
            <ResizableHandle className="!h-px !bg-border-glass" />
            <ResizablePanel defaultSize={40} minSize={15} maxSize={75} data-testid="aux-panel-section">
              <Panel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Collapsed state: tab strip always visible as a pinned footer */}
      {!panelVisible && <Panel collapsed />}
    </aside>
  );
}
