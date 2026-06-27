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
import { SourceControlView } from "./SourceControlView";
import { AgentOutputView } from "./AgentOutputView";

const TABS: Array<{ value: AuxiliaryView; label: string }> = [
  { value: "files", label: "Files" },
  { value: "diff", label: "Changes" },
  { value: "scm", label: "Source Control" },
  { value: "agent", label: "Agent" },
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
              className="flex w-full shrink-0 px-2"
              style={{ height: "var(--panel-tabs-height)", borderBottom: "1px solid hsl(var(--border))" }}
            >
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  data-testid={`aux-tab-${t.value}`}
                  className="flex-1"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {/* forceMount keeps all three panels mounted; Radix hides the
                inactive ones via the `hidden` attribute (display:none). This is
                the keep-alive contract (CLAUDE.md #6): switching tabs must not
                tear down a panel and lose its in-progress state — e.g. a
                half-typed commit message or staging selection in SourceControl. */}
            <TabsContent value="files" forceMount className="flex-1 overflow-hidden data-[state=inactive]:hidden">
              <FilesView />
            </TabsContent>
            <TabsContent value="diff" forceMount className="flex-1 overflow-hidden data-[state=inactive]:hidden">
              <DiffView />
            </TabsContent>
            <TabsContent value="scm" forceMount className="flex-1 overflow-hidden data-[state=inactive]:hidden">
              <SourceControlView />
            </TabsContent>
            <TabsContent value="agent" forceMount className="flex-1 overflow-hidden data-[state=inactive]:hidden">
              <AgentOutputView />
            </TabsContent>
          </Tabs>
        </ResizablePanel>

        {panelVisible && (
          <>
            <ResizableHandle />
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
