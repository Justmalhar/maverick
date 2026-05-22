// ⌘⇧B — embedded browser host with URL bar and element inspector overlay.
import { useCallback, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import BrowserToolbar from "./BrowserToolbar";
import ElementInspector from "./ElementInspector";

export default function BrowserPanel() {
  const [url, setUrl] = useState("http://localhost:3000");
  const [committedUrl, setCommittedUrl] = useState(url);
  const [inspecting, setInspecting] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [history, setHistory] = useState<string[]>([url]);
  const reduce = useReducedMotion();

  const navigate = useCallback(
    (next: string) => {
      const cleaned = next.trim();
      if (!cleaned) return;
      const target = /^https?:\/\//.test(cleaned) ? cleaned : `https://${cleaned}`;
      setUrl(target);
      setCommittedUrl(target);
      const sliced = history.slice(0, historyIdx + 1);
      sliced.push(target);
      setHistory(sliced);
      setHistoryIdx(sliced.length - 1);
    },
    [history, historyIdx]
  );

  const back = useCallback(() => {
    if (historyIdx === 0) return;
    const idx = historyIdx - 1;
    setHistoryIdx(idx);
    setUrl(history[idx]);
    setCommittedUrl(history[idx]);
  }, [historyIdx, history]);

  const forward = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const idx = historyIdx + 1;
    setHistoryIdx(idx);
    setUrl(history[idx]);
    setCommittedUrl(history[idx]);
  }, [historyIdx, history]);

  const refresh = useCallback(() => {
    if (iframeRef.current) {
      // Force reload by clobbering src.
      const current = iframeRef.current.src;
      iframeRef.current.src = "about:blank";
      requestAnimationFrame(() => {
        if (iframeRef.current) iframeRef.current.src = current;
      });
    }
  }, []);

  const stop = useCallback(() => {
    iframeRef.current?.contentWindow?.stop?.();
  }, []);

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
        onToggleInspect={() => setInspecting((s) => !s)}
      />
      <div className="relative min-h-0 flex-1 bg-card/30">
        {/* TODO: replace with Tauri WebviewWindow for native browser; iframe is v0.1 fallback. */}
        <iframe
          ref={iframeRef}
          src={committedUrl}
          title="browser"
          data-testid="browser-iframe"
          className="h-full w-full border-0 bg-background"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
        />
        {inspecting && <ElementInspector iframeRef={iframeRef} />}
      </div>
    </motion.div>
  );
}
