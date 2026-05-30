// ⌘⇧B — embedded browser host. Renders a placeholder region and pins a native
// Tauri child webview (label "maverick-browser") to its bounds. Element capture
// is handled by an injected script that emits `browser://captured` events.
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import {
  browserClose,
  browserEval,
  browserHide,
  browserNavigate,
  browserOpen,
  browserSetBounds,
  browserShow,
  onBrowserElementCaptured,
  type BrowserBounds,
} from "@/lib/tauri";
import BrowserToolbar from "./BrowserToolbar";

function rectOf(el: HTMLElement): BrowserBounds {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

// Native webview calls are fire-and-forget; failures (e.g. webview already
// gone) are non-fatal and intentionally swallowed.
function swallow(): void {}

export default function BrowserPanel() {
  const [url, setUrl] = useState("http://localhost:3000");
  const [inspecting, setInspecting] = useState(false);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [history, setHistory] = useState<string[]>(["http://localhost:3000"]);
  const hostRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const anyOverlayOpen = useWorkbench((s) =>
    [
      s.settingsOpen,
      s.quickOpenOpen,
      s.commandPaletteOpen,
      s.presetLauncherOpen,
      s.keybindingHelpOpen,
      s.projectSettings.open,
    ].some(Boolean)
  );

  // Open the native webview on mount; close it on unmount so it never lingers
  // over other panels.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    void browserOpen("http://localhost:3000", rectOf(host)).catch((e) =>
      console.error("browser open failed", e)
    );
    return () => {
      void browserClose().catch(swallow);
    };
    // Open once on mount; navigation is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the native webview pinned to the host rect on resize/layout changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const sync = () => void browserSetBounds(rectOf(host)).catch(swallow);
    const ro = new ResizeObserver(sync);
    ro.observe(host);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  // Hide the native layer while a modal overlay is open (it would float on top).
  useEffect(() => {
    if (anyOverlayOpen) {
      void browserHide().catch(swallow);
    } else {
      void browserShow().catch(swallow);
    }
  }, [anyOverlayOpen]);

  // Captured elements flow into the agent input bar.
  useEffect(() => {
    const unlisten = onBrowserElementCaptured(({ selector, text }) => {
      window.dispatchEvent(
        new CustomEvent("maverick:input-append", {
          detail: { text: `@selector:${selector} ${text ? `// ${text}` : ""}` },
        })
      );
    });
    return () => {
      unlisten.then((u) => u()).catch(swallow);
    };
  }, []);

  const goTo = useCallback((target: string) => {
    void browserNavigate(target).catch((e) => console.error("browser navigate failed", e));
  }, []);

  const navigate = useCallback(
    (next: string) => {
      const cleaned = next.trim();
      if (!cleaned) return;
      const target = /^https?:\/\//.test(cleaned) ? cleaned : `https://${cleaned}`;
      setUrl(target);
      setHistory((h) => {
        const sliced = h.slice(0, historyIdx + 1);
        sliced.push(target);
        setHistoryIdx(sliced.length - 1);
        return sliced;
      });
      goTo(target);
    },
    [historyIdx, goTo]
  );

  const back = useCallback(() => {
    if (historyIdx === 0) return;
    const idx = historyIdx - 1;
    setHistoryIdx(idx);
    setUrl(history[idx]);
    goTo(history[idx]);
  }, [historyIdx, history, goTo]);

  const forward = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const idx = historyIdx + 1;
    setHistoryIdx(idx);
    setUrl(history[idx]);
    goTo(history[idx]);
  }, [historyIdx, history, goTo]);

  const refresh = useCallback(() => {
    void browserEval("location.reload()").catch(swallow);
  }, []);

  const stop = useCallback(() => {
    void browserEval("window.stop()").catch(swallow);
  }, []);

  const toggleInspect = useCallback(() => {
    setInspecting((prev) => {
      const next = !prev;
      void browserEval(
        next
          ? "window.__mvInspect && window.__mvInspect.enable()"
          : "window.__mvInspect && window.__mvInspect.disable()"
      ).catch(swallow);
      return next;
    });
  }, []);

  // ⌘⇧I — global shortcut delegates inspect toggle via custom event.
  useEffect(() => {
    const handler = () => toggleInspect();
    window.addEventListener("maverick:browser:toggleInspect", handler);
    return () => {
      window.removeEventListener("maverick:browser:toggleInspect", handler);
    };
  }, [toggleInspect]);

  return (
    <motion.div
      data-testid="browser-panel"
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <BrowserToolbar
        url={url}
        onUrlChange={setUrl}
        onNavigate={() => navigate(url)}
        onBack={back}
        onForward={forward}
        onRefresh={refresh}
        onStop={stop}
        canBack={historyIdx > 0}
        canForward={historyIdx < history.length - 1}
        inspecting={inspecting}
        onToggleInspect={toggleInspect}
      />
      {/* The native webview is pinned over this region by the Rust layer. */}
      <div
        ref={hostRef}
        data-testid="browser-host"
        className="relative min-h-0 flex-1 bg-card/20"
      >
        <div
          data-testid="browser-overlay-note"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground"
        >
          {anyOverlayOpen ? "Browser hidden while a dialog is open" : ""}
        </div>
      </div>
    </motion.div>
  );
}
