import { useEffect, useRef, useState } from "react";
import { TerminalRegistry, type TerminalHandle } from "@/lib/terminal-provider";
import { useThemeContext } from "@/themes/theme-provider";
import { usePty } from "@/hooks/usePty";
import { cn } from "@/lib/utils";

// Concrete stack mirroring --font-mono. xterm measures char size off this, so a
// CSS var() (which may not resolve in its offscreen measurement) is avoided.
const MONO_FONT_STACK =
  '"Geist Mono", ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "Roboto Mono", Consolas, "Liberation Mono", monospace';

interface Props {
  ptyId: string;
  paneId: string;
  isFocused: boolean;
  onFocus: (paneId: string) => void;
}

export function TerminalPane({ ptyId, paneId, isFocused, onFocus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const [mounted, setMounted] = useState(false);
  const { theme } = useThemeContext();
  const { attach, write, resize } = usePty(ptyId);

  useEffect(() => {
    if (!containerRef.current || mounted) return;
    const handle = TerminalRegistry.get().mount(containerRef.current, {
      theme: theme.terminal,
      fontSize: 13,
      fontFamily: MONO_FONT_STACK,
      lineHeight: 1.2,
      ligatures: false,
      scrollback: 5000,
    });
    attach(handle);
    handleRef.current = handle;
    setMounted(true);
    // Grab keyboard focus immediately so a freshly-opened terminal is typeable
    // without an extra click.
    handle.focus();

    // Pipe user keystrokes/paste back to the PTY.
    const offData = handle.onData((data) => {
      void write(data);
    });

    // Keep the PTY at the renderer's exact fitted grid size, otherwise the
    // program's TUI draws for the wrong width and overlaps.
    const offResize = handle.onResize((cols, rows) => {
      void resize(cols, rows);
    });

    const onClear = () => handle.write("\x1b[2J\x1b[H");
    window.addEventListener("maverick:terminal:clear", onClear);

    return () => {
      window.removeEventListener("maverick:terminal:clear", onClear);
      offData();
      offResize();
      handle.dispose();
      handleRef.current = null;
      attach(null);
    };
    // Mount once per ptyId; theme updates handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId]);

  // Refocus when this pane becomes the active one (e.g. tab/pane switch).
  useEffect(() => {
    if (isFocused) handleRef.current?.focus();
  }, [isFocused]);

  return (
    <div
      data-testid={`terminal-pane-${paneId}`}
      onMouseDown={() => onFocus(paneId)}
      className={cn(
        "mv-terminal-pane relative h-full w-full overflow-hidden rounded-sm bg-background",
        isFocused
          ? "ring-1 ring-primary"
          : "ring-1 ring-transparent"
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
