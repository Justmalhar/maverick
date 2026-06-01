import { useEffect, useRef } from "react";
import {
  TerminalRegistry,
  type TerminalHandle,
  type PooledTerminalHandle,
  type PtyBridge,
} from "@/lib/terminal-provider";
import { useThemeContext } from "@/themes/theme-provider";
import { usePty } from "@/hooks/usePty";
import { setLeafFocused } from "@/lib/providers/terminal-session";
import { cn } from "@/lib/utils";

// The terminal renders arbitrary program output — including Powerline / Nerd
// Font glyphs from prompts like powerlevel10k — so it prefers an installed Nerd
// Font (MesloLGS NF is p10k's default) for full glyph coverage, then falls back
// to Geist Mono and the platform monospace stack when none is installed. xterm
// measures char size off the first resolved family, so every entry is a real
// monospace. A concrete stack is used (not a CSS var) because xterm's offscreen
// measurement may not resolve var().
const MONO_FONT_STACK =
  '"MesloLGS NF", "MesloLGS Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", "Symbols Nerd Font", "Geist Mono", ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "Roboto Mono", Consolas, "Liberation Mono", monospace';

interface Props {
  ptyId: string;
  paneId: string;
  isFocused: boolean;
  onFocus: (paneId: string) => void;
  // The pane is inside the live editor window. When false the expensive xterm
  // slot is released (scrollback serialized, slot recycled); the PTY/session
  // survives and re-binds without losing output when this flips back to true.
  visible?: boolean;
  // Fires with raw keystroke bytes the user types into this pane (before they
  // reach the PTY). The agent path taps this to detect submitted prompts for
  // token-usage estimation; the regular terminal leaves it unset.
  onData?: (data: string) => void;
  // Fires with raw PTY output bytes (pty:data) as they arrive. The agent path
  // taps this to drive the activity-based per-workspace status pill.
  onOutput?: (data: string) => void;
  // Fires on pty:exit with the process exit code. Lets the agent path mark the
  // workspace done/errored.
  onExit?: (code: number) => void;
}

export function TerminalPane({
  ptyId,
  paneId,
  isFocused,
  onFocus,
  visible = true,
  onData,
  onOutput,
  onExit,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const pooledRef = useRef<PooledTerminalHandle | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const { theme } = useThemeContext();
  // Pooled path routes pty:data through the session (slot or dormant ring). We
  // also tee output to onOutput (status detection) and exit to onExit, while
  // preserving the renderer feed so scrollback / dormant-ring behaviour is
  // unchanged.
  const { write, resize, kick } = usePty(ptyId, {
    feed: (data) => {
      onOutputRef.current?.(data);
      pooledRef.current?.feed(data);
    },
    onExit: onExitRef.current ? (code) => onExitRef.current?.(code) : undefined,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const provider = TerminalRegistry.get();
    const options = {
      theme: theme.terminal,
      fontSize: 13,
      fontFamily: MONO_FONT_STACK,
      lineHeight: 1.2,
      ligatures: false,
      scrollback: 5000,
    };

    let cleanup: () => void;

    if (provider.acquireLeaf) {
      const bridge: PtyBridge = {
        writeToPty: (data) => {
          onDataRef.current?.(data);
          void write(data);
        },
        resizePty: (cols, rows) => void resize(cols, rows),
        kickPty: (cols, rows) => void kick(cols, rows),
      };
      const pooled = provider.acquireLeaf(paneId, options, bridge);
      pooledRef.current = pooled;
      if (visible) pooled.acquire(container);
      const offResize = pooled.onResize((cols, rows) => void resize(cols, rows));
      if (isFocused) pooled.focus();
      cleanup = () => {
        offResize();
        pooled.dispose();
        pooledRef.current = null;
      };
    } else {
      // Mount-only provider (e.g. a test stub): fall back to a dedicated
      // renderer per pane. No pool, but the contract is identical.
      const handle = provider.mount(container, options);
      handleRef.current = handle;
      handle.focus();
      const offData = handle.onData((data) => {
        onDataRef.current?.(data);
        void write(data);
      });
      const offResize = handle.onResize((cols, rows) => void resize(cols, rows));
      cleanup = () => {
        offData();
        offResize();
        handle.dispose();
        handleRef.current = null;
      };
    }

    const onClear = () => {
      if (pooledRef.current) pooledRef.current.feed("\x1b[2J\x1b[H");
      else handleRef.current?.write("\x1b[2J\x1b[H");
    };
    window.addEventListener("maverick:terminal:clear", onClear);

    return () => {
      window.removeEventListener("maverick:terminal:clear", onClear);
      cleanup();
    };
    // Mount once per paneId/ptyId; theme + visibility handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId, paneId]);

  // Acquire when scrolling into the live window, release when out. The session
  // (PTY + dormant ring) survives either way — only the renderer slot moves.
  useEffect(() => {
    const pooled = pooledRef.current;
    if (!pooled) return;
    if (visible && containerRef.current) pooled.acquire(containerRef.current);
    else if (!visible) pooled.release();
  }, [visible]);

  // Refocus when this pane becomes the active one (e.g. tab/pane switch). Mark
  // the leaf focused so the renderer pool never evicts the active terminal's
  // slot under pressure; clear it on blur/unmount.
  useEffect(() => {
    setLeafFocused(paneId, isFocused);
    if (isFocused) {
      if (pooledRef.current) pooledRef.current.focus();
      else handleRef.current?.focus();
    }
    return () => setLeafFocused(paneId, false);
  }, [isFocused, paneId]);

  return (
    <div
      data-testid={`terminal-pane-${paneId}`}
      onMouseDown={() => onFocus(paneId)}
      className={cn(
        "mv-terminal-pane relative h-full w-full overflow-hidden rounded-sm bg-background",
        isFocused ? "ring-1 ring-primary" : "ring-1 ring-transparent"
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
