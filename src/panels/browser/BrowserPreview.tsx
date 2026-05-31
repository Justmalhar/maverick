// Suspendable sandboxed-iframe preview engine (the DEFAULT browser engine).
//
// WHY this is the default over the native add_child WebviewWindow:
// the native path (browser.rs) relies on add_child geometry / z-order pinning
// that cannot be exercised in a headless CI/jsdom environment (no `tauri dev`),
// so it is unverifiable here. The sandboxed iframe renders inside the React
// tree, is fully testable, and is memory-safe via self-suspension. The native
// engine remains available behind the `browser.engine` setting for users who
// need to embed sites that send X-Frame-Options/CSP frame-ancestors denials.
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { PORT_PRESETS, isLocalUrl, probeUrl } from "./port-presets";

// Tear the iframe down after this much invisibility — a background dev-server
// page can hold hundreds of MB inside the WebView.
const SUSPEND_AFTER_MS = 30_000;

export interface BrowserPreviewHandle {
  reload: () => void;
}

interface Props {
  url: string;
  visible: boolean;
  onNavigate: (url: string) => void;
  onOpenExternal: (url: string) => void;
}

export const BrowserPreview = forwardRef<BrowserPreviewHandle, Props>(
  function BrowserPreview({ url, visible, onNavigate, onOpenExternal }, ref) {
    // `nonce` is part of the iframe `key`. Bumping it remounts the iframe,
    // which is the only reliable cross-origin reload (calling
    // contentWindow.location.reload() throws on cross-origin frames).
    const [nonce, setNonce] = useState(0);
    const [loaded, setLoaded] = useState(visible);
    const [checkingPort, setCheckingPort] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const suspendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      if (visible) {
        setLoaded(true);
        return;
      }
      const t = setTimeout(() => setLoaded(false), SUSPEND_AFTER_MS);
      suspendTimer.current = t;
      return () => clearTimeout(t);
    }, [visible]);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => {
          setLoaded(true);
          setNonce((n) => n + 1);
        },
      }),
      []
    );

    const tryPort = async (port: number) => {
      setNotice(null);
      setCheckingPort(port);
      const target = `http://localhost:${port}`;
      const ok = await probeUrl(target);
      setCheckingPort(null);
      if (!ok) {
        setNotice(`No server listening on :${port}.`);
        return;
      }
      onNavigate(target);
    };

    const showXfoHint = url ? !isLocalUrl(url) : false;

    return (
      <div
        data-testid="browser-preview"
        className="flex h-full w-full flex-col bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-card/40 px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                data-testid="browser-ports"
                title="Common dev-server ports"
              >
                <Globe className="h-3 w-3" />
                <span>Ports</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
              {PORT_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p.port}
                  data-testid={`browser-port-${p.port}`}
                  onSelect={(e) => {
                    e.preventDefault();
                    void tryPort(p.port);
                  }}
                >
                  <span className="flex-1">{p.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {checkingPort === p.port ? "checking…" : `:${p.port}`}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-auto truncate text-[11px] text-muted-foreground">{url}</span>
        </div>

        {showXfoHint && (
          <div
            data-testid="browser-xfo-hint"
            className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-muted px-3 text-[11px] text-muted-foreground"
          >
            <span className="truncate">
              Many public sites refuse to embed (X-Frame-Options). If the page is blank,
            </span>
            <button
              type="button"
              data-testid="browser-open-external"
              onClick={() => onOpenExternal(url)}
              className="shrink-0 rounded px-1 text-foreground underline hover:bg-accent"
            >
              open externally
            </button>
            .
          </div>
        )}

        {notice && (
          <div
            data-testid="browser-notice"
            className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-1 text-[11px] text-muted-foreground"
          >
            <span className="truncate">{notice}</span>
            <button
              type="button"
              data-testid="browser-notice-dismiss"
              onClick={() => setNotice(null)}
              className="ml-auto rounded px-1 text-[10px] hover:bg-accent"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="relative min-h-0 flex-1 bg-background">
          {loaded ? (
            <iframe
              key={`${url}#${nonce}`}
              src={url}
              title="Preview"
              data-testid="browser-iframe"
              className="h-full w-full border-0 bg-background"
              // sandbox grants the bare minimum for a dev preview: scripts,
              // same-origin (cookies/storage for the previewed app), forms,
              // popups for "open in new tab". Critically OMITS
              // `allow-top-navigation*` — without it the iframe cannot navigate
              // the parent Tauri webview to an attacker origin, which would
              // otherwise expose Tauri IPC.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              referrerPolicy="no-referrer"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          ) : (
            <div
              data-testid="browser-suspended"
              className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"
            >
              <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                <Globe className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-foreground">Preview suspended</p>
              <p className="max-w-xs text-[11px] text-muted-foreground">
                Released to free memory after sitting in the background.
              </p>
              <button
                type="button"
                data-testid="browser-resume"
                onClick={() => {
                  setLoaded(true);
                  setNonce((n) => n + 1);
                }}
                className="rounded-md border border-border bg-card px-3 py-1 text-[11px] hover:bg-accent"
              >
                Reload
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
);
