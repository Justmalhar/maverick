import type { FileTab } from "@/state/store";

export interface FileTabPaneProps {
  tab: FileTab;
  active: boolean;
}

// Body replaced in Task D3 with registry-driven viewer rendering.
export default function FileTabPane({ tab }: FileTabPaneProps) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {tab.path}
    </div>
  );
}
