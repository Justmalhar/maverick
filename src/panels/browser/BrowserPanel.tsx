// ⌘⇧B — embedded browser host. Two interchangeable engines selected by the
// `browser.engine` setting:
//
//   "iframe" (DEFAULT) — a sandboxed, self-suspending <iframe> rendered inside
//     the React tree. Fully testable headlessly, memory-safe, and cannot reach
//     Tauri IPC (sandbox omits allow-top-navigation). See BrowserPreview.tsx.
//
//   "native" — a Tauri child WebviewWindow (label "maverick-browser") pinned
//     over the host rect by the Rust layer (browser.rs). Embeds sites that deny
//     iframing (X-Frame-Options/CSP). Its add_child geometry / z-order CANNOT
//     be verified in this headless environment, so it is opt-in.
//
// KEEP-ALIVE: this panel is mounted by EditorGroup for the lifetime of the
// browser system tab and toggled via the `visible` prop. When `visible` flips
// off we HIDE the native webview (never close) so page/URL/history survive a
// tab switch — mirroring the terminal keep-alive contract. The native webview
// is closed only on real unmount.
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import { useSettings } from "@/lib/stores/settings";
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
import { normalizeUrl } from "./port-presets";
import BrowserToolbar from "./BrowserToolbar";
import { BrowserPreview, type BrowserPreviewHandle } from "./BrowserPreview";

const DEFAULT_URL = "http://localhost:3000";

function rectOf(el: HTMLElement): BrowserBounds {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

// Native webview calls are fire-and-forget; failures (e.g. webview already
// gone) are non-fatal and intentionally swallowed.
function swallow(): void {}

interface Props {
  // Whether this panel is the active editor tab. Defaults to true so the
  // panel works standalone (e.g. in isolation tests).
  visible?: boolean;
}

export default function BrowserPanel({ visible = true }: Props) {
  const [engine] = useSettings("browser.engine", "iframe");
  const native = engine === "native";

  // `url` is the committed navigation target (drives the iframe / native nav);
  // `address` is the editable URL-bar draft. Keeping them separate prevents the
  // iframe from reloading on every keystroke.
  const [url, setUrl] = useState(DEFAULT_URL);
  const [address, setAddress] = useState(DEFAULT_URL);
  const [inspecting, setInspecting] = useState(false);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [history, setHistory] = useState<string[]>([DEFAULT_URL]);
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<BrowserPreviewHandle>(null);
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

  // ---- Native engine lifecycle --------------------------------------------

  // Open the native webview on mount (native engine only); close it on real
  // unmount so it never lingers over other panels.
  useEffect(() => {
    if (!native) return;
    const host = hostRef.current;
    if (!host) return;
    void browserOpen(DEFAULT_URL, rectOf(host)).catch((e) =>
      console.error("browser open failed", e)
    );
    return () => {
      void browserClose().catch(swallow);
    };
    // Open once on mount; navigation is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  // Keep the native webview pinned to the host rect on resize/layout changes.
  useEffect(() => {
    if (!native) return;
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
  }, [native]);

  // Hide the native layer while a modal overlay is open OR while this tab is
  // inactive (keep-alive: hide, never close); show it again otherwise.
  useEffect(() => {
    if (!native) return;
    if (anyOverlayOpen || !visible) {
      void browserHide().catch(swallow);
    } else {
      void browserShow().catch(swallow);
    }
  }, [native, anyOverlayOpen, visible]);

  // ---- Element capture ----------------------------------------------------

  // Captured elements flow into the agent input bar (native engine emits these
  // via the browser_capture command; harmless to listen in iframe mode too).
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

  // ---- Navigation (engine-agnostic) ---------------------------------------

  const goTo = useCallback(
    (target: string) => {
      if (native) {
        void browserNavigate(target).catch((e) => console.error("browser navigate failed", e));
      }
      // iframe engine navigates declaratively via the `url` prop + key remount.
    },
    [native]
  );

  const navigate = useCallback(
    (next: string) => {
      const target = normalizeUrl(next);
      if (!target) return;
      setUrl(target);
      setAddress(target);
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
    setAddress(history[idx]);
    goTo(history[idx]);
  }, [historyIdx, history, goTo]);

  const forward = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const idx = historyIdx + 1;
    setHistoryIdx(idx);
    setUrl(history[idx]);
    setAddress(history[idx]);
    goTo(history[idx]);
  }, [historyIdx, history, goTo]);

  const refresh = useCallback(() => {
    if (native) {
      void browserEval("location.reload()").catch(swallow);
    } else {
      previewRef.current?.reload();
    }
  }, [native]);

  const stop = useCallback(() => {
    if (native) {
      void browserEval("window.stop()").catch(swallow);
    }
  }, [native]);

  // Caller (BrowserPreview) only surfaces the external-open affordance for a
  // non-empty remote URL, so no empty-target guard is needed here.
  const openExternal = useCallback((target: string) => {
    void import("@tauri-apps/plugin-shell")
      .then((m) => m.open(target))
      .catch((e) => console.error("browser open external failed", e));
  }, []);

  // ---- Inspector (native engine only) -------------------------------------

  const toggleInspect = useCallback(() => {
    setInspecting((prev) => {
      const next = !prev;
      if (native) {
        void browserEval(
          next
            ? "window.__mvInspect && window.__mvInspect.enable()"
            : "window.__mvInspect && window.__mvInspect.disable()"
        ).catch(swallow);
      }
      return next;
    });
  }, [native]);

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
      data-engine={engine}
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <BrowserToolbar
        url={address}
        onUrlChange={setAddress}
        onNavigate={() => navigate(address)}
        onBack={back}
        onForward={forward}
        onRefresh={refresh}
        onStop={stop}
        canBack={historyIdx > 0}
        canForward={historyIdx < history.length - 1}
        inspecting={inspecting}
        onToggleInspect={toggleInspect}
      />
      {native ? (
        // The native webview is pinned over this region by the Rust layer.
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
      ) : (
        <div data-testid="browser-host" className="relative min-h-0 flex-1">
          <BrowserPreview
            ref={previewRef}
            url={url}
            visible={visible && !anyOverlayOpen}
            onNavigate={navigate}
            onOpenExternal={openExternal}
          />
        </div>
      )}
    </motion.div>
  );
}
