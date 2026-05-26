import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Loader2 } from "lucide-react";
import { readGlobalMd, writeGlobalMd } from "@/lib/tauri";

const PLACEHOLDER = `# Tell every agent how you like to work

Examples:

- Use TypeScript strict mode and avoid \`any\`.
- Prefer bun over npm or yarn.
- Keep commits small and write descriptive messages.
- When refactoring, run tests after every change.

These notes are shared across every project — you can override them per-repo later.`;

type SaveState = "idle" | "saving" | "saved";

export function InstructionsStep() {
  const [text, setText] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    readGlobalMd()
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
      writeGlobalMd(next)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("idle"));
    }, 400);
  }

  return (
    <div data-testid="firstrun-step-instructions" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Your instructions</h2>
        <p className="text-[12px] text-muted-foreground">
          Plain-English notes every AI agent will read at the start of each chat. Skip if
          you&apos;d rather set this up later.
        </p>
      </div>

      <div className="relative">
        <textarea
          data-testid="instructions-textarea"
          aria-label="Global instructions"
          value={text ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={9}
          className="w-full resize-none rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
        />
        <div className="absolute bottom-2 right-3 flex items-center gap-1 text-[10px] text-muted-foreground">
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

      <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <BookOpen className="mt-0.5 h-3 w-3 shrink-0" />
        Stored in <code className="font-mono text-foreground/80">GLOBAL.md</code>. Edit any
        time from Settings → Appearance, or replace per-repo with a project-local
        <code className="font-mono text-foreground/80">MAVERICK.md</code>.
      </p>
    </div>
  );
}
