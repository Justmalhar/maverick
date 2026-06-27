import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { useWorkbench, type FileTab } from "@/state/store";
import { viewerRegistry } from "@/lib/viewers";
import {
  fileMetaForPath,
  type FileMeta,
  type ViewerActions,
  type ViewerIntent,
  type ViewerProps,
} from "@/lib/viewers/types";
import { fileRead } from "@/lib/tauri";
import { disposeModelForPath } from "@/lib/viewers/monaco/model-cache";
import { ViewerToolbar } from "./ViewerToolbar";
import { lazyViewerCache } from "./lazy-viewer-cache";

export interface FileTabPaneProps {
  tab: FileTab;
  active: boolean;
}

function intentFor(tab: FileTab): ViewerIntent {
  if (tab.kind === "diff" && tab.mode === "diff") return "diff";
  return tab.mode === "view" ? "preview" : "edit";
}

export default function FileTabPane({ tab }: FileTabPaneProps) {
  const live = useWorkbench((s) => s.fileTabs.find((t) => t.id === tab.id)) ?? tab;
  const setFileTabDirty = useWorkbench((s) => s.setFileTabDirty);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [actions, setActions] = useState<ViewerActions>({});

  // Stable callback identity — prevents CodeViewer/DiffViewer main effects from
  // re-running (and recreating the Monaco editor) on every dirty-state toggle.
  // zustand action references are stable across renders.
  const onDirtyChange = useCallback(
    (d: boolean) => setFileTabDirty(live.id, d),
    [setFileTabDirty, live.id]
  );

  useEffect(() => {
    let cancelled = false;
    fileRead(live.path)
      .then((res) => {
        if (!cancelled) setMeta(fileMetaForPath(live.path, { binary: res.binary, size: res.size }));
      })
      .catch(() => {
        if (!cancelled) setMeta(fileMetaForPath(live.path));
      });
    return () => {
      cancelled = true;
    };
  }, [live.path]);

  // When this tab pane unmounts (tab is closed, not just viewer-swapped), dispose
  // the Monaco model. React unmounts children before running parent cleanup, so
  // the viewer's releaseModel (refs→0) fires first, then disposeModelForPath
  // actually frees the model. No-ops for non-text files that never acquired a model.
  useEffect(() => () => disposeModelForPath(live.path), [live.path]);

  const intent = intentFor(live);
  const candidates = useMemo(
    () => (meta ? viewerRegistry.resolve(meta, intent) : []),
    [meta, intent]
  );
  const descriptor =
    (live.viewerId && viewerRegistry.get(live.viewerId)) || candidates[0];

  const Viewer = useMemo<ComponentType<ViewerProps> | null>(() => {
    if (!descriptor) return null;
    let component = lazyViewerCache.get(descriptor.id);
    if (!component) {
      component = lazy(async () => ({ default: await descriptor.load() }));
      lazyViewerCache.set(descriptor.id, component);
    }
    return component;
  }, [descriptor]);

  if (!meta) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <ViewerToolbar tab={live} actions={actions} candidates={candidates} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {Viewer ? (
          <Suspense fallback={null}>
            <Viewer
              tab={live}
              meta={meta}
              onDirtyChange={onDirtyChange}
              registerActions={setActions}
            />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No viewer available for this file.
          </div>
        )}
      </div>
    </div>
  );
}
