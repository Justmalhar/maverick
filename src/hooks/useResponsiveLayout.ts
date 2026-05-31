import { useCallback, useEffect, useRef } from "react";
import { useWorkbench } from "@/state/store";

// Below this viewport width the ActivityBar / PrimarySideBar collapse to
// icon-only to reclaim horizontal space. Mirrors VSCode's responsive breakpoint.
export const COMPACT_BREAKPOINT_PX = 900;

const MEDIA_QUERY = `(min-width: ${COMPACT_BREAKPOINT_PX}px)`;

interface ResponsiveLayout {
  /** True when collapsed to icon-only. */
  collapsed: boolean;
  /** Manual override toggle — wins until the breakpoint is next crossed. */
  toggle: () => void;
}

/**
 * Drives `layout.activitybarCollapsed` from a `min-width:900px` media query.
 * Below the breakpoint the chrome collapses to icon-only; at or above it the
 * chrome expands. A manual `toggle()` overrides the query until the breakpoint
 * is next crossed (matching VSCode's "respect my choice within this size" UX).
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const collapsed = useWorkbench((s) => s.layout.activitybarCollapsed);
  const setCollapsed = useWorkbench((s) => s.setActivitybarCollapsed);
  const toggleCollapsed = useWorkbench((s) => s.toggleActivitybarCollapsed);
  // Tracks whether the user has manually overridden the media-query default for
  // the current breakpoint side. A manual choice holds until the next cross.
  const manualRef = useRef(false);
  // The `matches` value last applied from the query. A `change` event whose
  // matches equals this is a within-range fire (not a real cross) and must
  // therefore not stomp a manual override.
  const lastMatchesRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(MEDIA_QUERY);
    const apply = (wide: boolean) => {
      manualRef.current = false;
      lastMatchesRef.current = wide;
      setCollapsed(!wide);
    };
    apply(mql.matches);
    const onChange = (e: MediaQueryListEvent) => {
      // Within-range fire (no actual cross): keep an in-effect manual override.
      if (manualRef.current && e.matches === lastMatchesRef.current) return;
      apply(e.matches);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [setCollapsed]);

  const toggle = useCallback(() => {
    manualRef.current = true;
    toggleCollapsed();
  }, [toggleCollapsed]);

  return { collapsed, toggle };
}

export const __testing__ = { MEDIA_QUERY };
