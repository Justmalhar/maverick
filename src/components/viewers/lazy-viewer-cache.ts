import type { ComponentType } from "react";
import type { ViewerProps } from "@/lib/viewers/types";

// Module-level cache keyed by descriptor id. Ensures the lazy() wrapper for a
// given viewer id is created exactly once — even if the descriptor object
// reference changes (e.g. intent flip rebuilds candidates → new resolve → same
// id but new winner object). A fresh lazy() per render would make React treat
// the Viewer as a NEW component type, unmounting + remounting the subtree and
// destroying editor state (violates keep-alive rule 6).
//
// Lives outside FileTabPane.tsx so that module exports only its component
// (Fast Refresh requirement).
export const lazyViewerCache = new Map<string, ComponentType<ViewerProps>>();
