import type { ComponentType } from "react";
import type { FileTab } from "@/state/store";

export type ViewerIntent = "preview" | "edit" | "diff";

export interface FileMeta {
  /** Absolute path. */
  path: string;
  /** Basename. */
  name: string;
  /** Lowercase extension without the dot; "" when none. */
  ext: string;
  binary: boolean;
  size: number;
}

export interface ViewerActions {
  save?: () => Promise<void>;
  copyContents?: () => Promise<void>;
  discardChanges?: () => Promise<void>;
}

export interface ViewerProps {
  tab: FileTab;
  meta: FileMeta;
  onDirtyChange: (dirty: boolean) => void;
  /** Viewers register imperative actions; the toolbar binds its buttons to them. */
  registerActions: (actions: ViewerActions) => void;
}

export interface ViewerDescriptor {
  id: string;
  displayName: string;
  /** Higher wins among canHandle matches. */
  priority: number;
  capabilities: { edit?: boolean; diff?: boolean };
  canHandle: (file: FileMeta, intent: ViewerIntent) => boolean;
  /** Every viewer lazy-loads — heavy deps stay out of the shell bundle. */
  load: () => Promise<ComponentType<ViewerProps>>;
}

export function fileMetaForPath(path: string, opts: { binary?: boolean; size?: number } = {}): FileMeta {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return {
    path,
    name,
    ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
    binary: opts.binary ?? false,
    size: opts.size ?? 0,
  };
}
