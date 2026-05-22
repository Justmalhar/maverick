import { useState } from "react";
import { Play, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelTabs, type BottomPanelTab } from "./PanelTabs";

function PlaceholderPane({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Play;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-[13px] text-foreground">{title}</span>
      <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function Panel({ collapsed = false }: { collapsed?: boolean }) {
  const [tab, setTab] = useState<BottomPanelTab>("setup");

  return (
    <section
      data-testid="bottom-panel"
      className={cn(
        "mv-panel flex w-full flex-col bg-sidebar",
        collapsed ? "shrink-0" : "h-full"
      )}
      style={{ borderTop: "1px solid hsl(var(--border))" }}
    >
      <PanelTabs value={tab} onChange={setTab} />
      {!collapsed && (
        <div className="flex-1 overflow-hidden">
          {tab === "setup" && (
            <PlaceholderPane
              icon={Wrench}
              title="Setup"
              hint="Run repository setup scripts defined in maverick.json"
            />
          )}
          {tab === "run" && (
            <PlaceholderPane
              icon={Play}
              title="Run"
              hint="Process output for dev servers and test runners"
            />
          )}
        </div>
      )}
    </section>
  );
}
