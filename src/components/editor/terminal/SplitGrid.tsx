import type { SplitNode } from "@/lib/ipc";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { TerminalPane } from "./TerminalPane";

interface Props {
  tree: SplitNode;
  focusedPaneId: string | null;
  onFocus: (paneId: string) => void;
}

export function SplitGrid({ tree, focusedPaneId, onFocus }: Props) {
  if (tree.type === "terminal") {
    return (
      <div className="h-full w-full p-1">
        <TerminalPane
          paneId={tree.id}
          ptyId={tree.ptyId}
          isFocused={focusedPaneId === tree.id}
          onFocus={onFocus}
        />
      </div>
    );
  }

  const direction = tree.direction === "h" ? "horizontal" : "vertical";
  const defaultSize = Math.round(tree.ratio * 100);

  return (
    <ResizablePanelGroup direction={direction} className="h-full w-full">
      <ResizablePanel defaultSize={defaultSize} minSize={10}>
        <SplitGrid
          tree={tree.left}
          focusedPaneId={focusedPaneId}
          onFocus={onFocus}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={100 - defaultSize} minSize={10}>
        <SplitGrid
          tree={tree.right}
          focusedPaneId={focusedPaneId}
          onFocus={onFocus}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
