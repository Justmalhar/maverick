import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { readMaverickMd, writeMaverickMd } from "@/lib/tauri";

const PLACEHOLDER = `Examples:

- Use TypeScript strict mode and avoid \`any\`.
- Prefer bun over npm or yarn.
- Keep commits small with clear messages.
- After refactors, always run the test suite.

(Skip if you'd rather come back to this later.)`;

type SaveState = "idle" | "saving" | "saved";

export function InstructionsStep() {
  const [text, setText] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    readMaverickMd()
      .then((c) => {
        if (cancelled) return;
        // If the seeded comment is the only content, start with an empty editor.
        setText(c.trimStart().startsWith("<!--") ? "" : c);
      })
      .catch(() => {
        if (!cancelled) setText("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onChange(next: string) {
    setText(next);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      writeMaverickMd(next)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("idle"));
    }, 400);
  }

  return (
    <div data-testid="firstrun-step-instructions" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold text-foreground">Tell agents how you work</h2>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Plain-English notes every AI agent will read at the start of each chat. Saved as
          a single global file — drop a <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px] text-foreground">MAVERICK.md</code> inside any
          repo to override it for that project.
        </p>
      </div>

      <div className="relative">
        <textarea
          data-testid="instructions-textarea"
          aria-label="Maverick instructions"
          value={text ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={9}
          className="w-full resize-none rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          style={{ borderColor: "hsl(var(--muted-foreground) / 0.25)" }}
        />
        <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-1 text-[10px] text-muted-foreground">
          {saveState === "saving" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </>
          )}
          {saveState === "saved" && (
            <>
              <Check className="h-3 w-3 text-success" />
              Saved
            </>
          )}
        </div>
      </div>
    </div>
  );
}
