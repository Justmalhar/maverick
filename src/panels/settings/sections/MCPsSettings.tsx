// MCP global toggles — reuses MCPsPanel as the source-of-truth UI.
import MCPsPanel from "@/panels/mcps/MCPsPanel";

export default function MCPsSettings() {
  return (
    <section data-testid="mcps-settings" className="flex h-full flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">MCP Servers</h3>
      <div className="h-[60vh] overflow-hidden rounded-sm border border-border">
        <MCPsPanel />
      </div>
    </section>
  );
}
