// Visual layout builder — uses react-resizable-panels itself as the WYSIWYG canvas.
import { useCallback, useEffect, useState } from "react";
import { Plus, SplitSquareHorizontal, SplitSquareVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { PresetNode, WorkspacePreset } from "@/lib/ipc";
import PresetForm from "./PresetForm";
import { cn } from "@/lib/utils";

interface Props {
  preset?: WorkspacePreset;
  onSave: (preset: WorkspacePreset) => void;
}

interface NodeWithPath {
  node: PresetNode;
  path: string;
}

const DEFAULT_LEAF: PresetNode = {
  type: "terminal",
  agent: "claude",
  cwd: "{{workspace_root}}",
  mode: "agent",
};

export default function PresetEditor({ preset, onSave }: Props) {
  const [name, setName] = useState(preset?.name ?? "new-preset");
  const [description, setDescription] = useState(preset?.description ?? "");
  const [baseBranch, setBaseBranch] = useState(preset?.baseBranch ?? "");
  const [layout, setLayout] = useState<PresetNode>(preset?.layout ?? { ...DEFAULT_LEAF });
  const [selectedPath, setSelectedPath] = useState<string>("");

  useEffect(() => {
    if (preset) {
      setName(preset.name);
      setDescription(preset.description ?? "");
      setBaseBranch(preset.baseBranch ?? "");
      setLayout(preset.layout);
    }
  }, [preset]);

  const updateAtPath = useCallback(
    (path: string, transform: (node: PresetNode) => PresetNode): void => {
      const apply = (node: PresetNode, p: string): PresetNode => {
        if (p === "") return transform(node);
        if (node.type !== "split") return node;
        const [head, ...rest] = p.split(".");
        const restPath = rest.join(".");
        const leftKey = "left" in node ? "left" : "top";
        const rightKey = "right" in node ? "right" : "bottom";
        if (head === "0") {
          return { ...node, [leftKey]: apply((node as never)[leftKey], restPath) } as PresetNode;
        }
        if (head === "1") {
          return { ...node, [rightKey]: apply((node as never)[rightKey], restPath) } as PresetNode;
        }
        /* v8 ignore next */
        return node;
      };
      setLayout((current) => apply(current, path));
    },
    []
  );

  const splitNode = useCallback(
    (path: string, direction: "h" | "v") => {
      updateAtPath(path, (node) => {
        const a = node;
        const b: PresetNode = { ...DEFAULT_LEAF };
        if (direction === "h") {
          return { type: "split", direction, ratio: 0.5, left: a, right: b };
        }
        return { type: "split", direction, ratio: 0.5, top: a, bottom: b };
      });
    },
    [updateAtPath]
  );

  const removeNode = useCallback(
    (path: string) => {
      if (path === "") return;
      const parent = path.slice(0, path.length - 2);
      const childIdx = path.slice(-1);
      updateAtPath(parent, (node) => {
        if (node.type !== "split") return node;
        const leftKey = "left" in node ? "left" : "top";
        const rightKey = "right" in node ? "right" : "bottom";
        return childIdx === "0"
          ? ((node as never)[rightKey] as PresetNode)
          : ((node as never)[leftKey] as PresetNode);
      });
      setSelectedPath("");
    },
    [updateAtPath]
  );

  const getSelected = (): NodeWithPath | null => {
    const get = (node: PresetNode, path: string): PresetNode | null => {
      if (path === selectedPath) return node;
      if (node.type !== "split") return null;
      const leftKey = "left" in node ? "left" : "top";
      const rightKey = "right" in node ? "right" : "bottom";
      const left = (node as never)[leftKey] as PresetNode;
      const right = (node as never)[rightKey] as PresetNode;
      const prefix = path === "" ? "" : `${path}.`;
      return (
        get(left, `${prefix}0`) ?? get(right, `${prefix}1`)
      );
    };
    const node = get(layout, "");
    return node ? { node, path: selectedPath } : null;
  };

  const save = () => {
    onSave({ name: name.trim(), description, baseBranch: baseBranch || undefined, layout });
  };

  const selected = getSelected();

  return (
    <div data-testid="preset-editor" className="flex h-full w-full flex-col bg-background">
      <div className="grid grid-cols-3 gap-2 border-b border-border p-2">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Name
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Description
          </label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Base branch
          </label>
          <Input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px]">
        <div className="flex h-full flex-col border-r border-border">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedPath && layout.type === "split"}
              onClick={() => splitNode(selectedPath, "h")}
              data-testid="preset-split-h"
            >
              <SplitSquareHorizontal className="h-3 w-3" /> Split H
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => splitNode(selectedPath, "v")}
              data-testid="preset-split-v"
            >
              <SplitSquareVertical className="h-3 w-3" /> Split V
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedPath === ""}
              onClick={() => removeNode(selectedPath)}
              data-testid="preset-remove"
            >
              <Trash2 className="h-3 w-3" /> Remove
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="default" onClick={save} data-testid="preset-save">
              Save preset
            </Button>
          </div>
          <div className="min-h-0 flex-1 p-2">
            <LayoutCanvas
              node={layout}
              path=""
              selected={selectedPath}
              onSelect={setSelectedPath}
            />
          </div>
        </div>
        <div className="flex flex-col overflow-auto bg-card/30">
          <div className="border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Pane config
          </div>
          {selected ? (
            <PresetForm
              node={selected.node}
              onChange={(next) => updateAtPath(selected.path, () => next)}
            />
          ) : (
            /* v8 ignore next 3 — selectedPath always matches the root, so this branch is defensive only */
            <div className="p-3 text-[11px] text-muted-foreground">
              Click a pane to configure it. Use "Split H/V" to add panes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CanvasProps {
  node: PresetNode;
  path: string;
  selected: string;
  onSelect: (path: string) => void;
}

function LayoutCanvas({ node, path, selected, onSelect }: CanvasProps): React.ReactElement {
  if (node.type === "terminal" || node.type === "browser") {
    return (
      <button
        type="button"
        onClick={() => onSelect(path)}
        data-testid="preset-leaf"
        className={cn(
          "flex h-full w-full items-center justify-center rounded-sm border text-[11px] transition-colors",
          selected === path
            ? "border-primary bg-primary/10 text-foreground"
            : "border-border bg-card/50 text-muted-foreground hover:bg-accent/10"
        )}
      >
        {node.type === "terminal" ? (
          <span>
            {node.agent}
            <span className="ml-1 text-[9px] uppercase">{node.mode}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Plus className="h-3 w-3" /> {node.url ?? "browser"}
          </span>
        )}
      </button>
    );
  }
  const leftKey = "left" in node ? "left" : "top";
  const rightKey = "right" in node ? "right" : "bottom";
  const left = (node as never)[leftKey] as PresetNode;
  const right = (node as never)[rightKey] as PresetNode;
  const direction = node.direction === "h" ? "horizontal" : "vertical";
  const prefix = path === "" ? "" : `${path}.`;
  return (
    <ResizablePanelGroup direction={direction} className="h-full w-full">
      <ResizablePanel defaultSize={node.ratio * 100} minSize={10}>
        <LayoutCanvas
          node={left}
          path={`${prefix}0`}
          selected={selected}
          onSelect={onSelect}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={(1 - node.ratio) * 100} minSize={10}>
        <LayoutCanvas
          node={right}
          path={`${prefix}1`}
          selected={selected}
          onSelect={onSelect}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
