import { useEffect, useRef, useState } from "react";
import { TerminalRegistry } from "@/lib/terminal-provider";
import { useTheme } from "@/hooks/useTheme";
import { usePty } from "@/hooks/usePty";
import { cn } from "@/lib/utils";

interface Props {
  ptyId: string;
  paneId: string;
  isFocused: boolean;
  onFocus: (paneId: string) => void;
}

export function TerminalPane({ ptyId, paneId, isFocused, onFocus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const { attach, resize } = usePty(ptyId);

  useEffect(() => {
    if (!containerRef.current || mounted) return;
    const handle = TerminalRegistry.get().mount(containerRef.current, {
      theme: theme.terminal,
      fontSize: 13,
      fontFamily: "var(--font-mono)",
      ligatures: false,
      scrollback: 5000,
    });
    attach(handle);
    setMounted(true);

    const onClear = () => handle.write("\x1b[2J\x1b[H");
    window.addEventListener("maverick:terminal:clear", onClear);

    return () => {
      window.removeEventListener("maverick:terminal:clear", onClear);
      handle.dispose();
      attach(null);
    };
    // Mount once per ptyId; theme updates handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        const cols = Math.max(2, Math.floor(rect.width / 8));
        const rows = Math.max(2, Math.floor(rect.height / 17));
        resize(cols, rows).catch(() => {});
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [resize]);

  return (
    <div
      data-testid={`terminal-pane-${paneId}`}
      onMouseDown={() => onFocus(paneId)}
      className={cn(
        "mv-terminal-pane relative h-full w-full overflow-hidden rounded-sm bg-black",
        isFocused
          ? "ring-1 ring-primary"
          : "ring-1 ring-transparent"
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
