import type { SplitNode, Workspace } from "@/lib/ipc";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { TerminalLeaf } from "./TerminalLeaf";

interface Props {
  tree: SplitNode;
  workspace: Workspace;
  focusedPaneId: string | null;
  onFocus: (paneId: string) => void;
}

export function SplitGrid({ tree, workspace, focusedPaneId, onFocus }: Props) {
  if (tree.type === "terminal") {
    return (
      <div className="h-full w-full p-1">
        <TerminalLeaf
          leafId={tree.id}
          workspace={workspace}
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
          workspace={workspace}
          focusedPaneId={focusedPaneId}
          onFocus={onFocus}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={100 - defaultSize} minSize={10}>
        <SplitGrid
          tree={tree.right}
          workspace={workspace}
          focusedPaneId={focusedPaneId}
          onFocus={onFocus}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
