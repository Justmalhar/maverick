import { useMemo, useState } from "react";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/lib/stores/settings";
import { SETTINGS_DEFAULTS, SETTINGS_KEYS } from "@/lib/stores/settings-defaults";
import type { SettingsKey, SettingsValue } from "@/lib/ipc";

interface Props {
  onClose: () => void;
}

function buildSnapshot(values: Record<string, SettingsValue | undefined>): string {
  // Include every known SettingsKey — fall back to the default when the user
  // hasn't explicitly set a value. Unknown keys (e.g. forward-compat additions
  // dropped in via the editor) are preserved at the end.
  const merged: Record<string, SettingsValue> = {};
  for (const key of SETTINGS_KEYS) {
    merged[key] = values[key] ?? SETTINGS_DEFAULTS[key];
  }
  const knownKeys = new Set<string>(SETTINGS_KEYS as readonly string[]);
  for (const key of Object.keys(values).sort()) {
    if (!knownKeys.has(key) && values[key] !== undefined) {
      merged[key] = values[key]!;
    }
  }
  return JSON.stringify(merged, null, 2);
}

export function SettingsJsonEditor({ onClose }: Props) {
  const values = useSettingsStore((s) => s.values);
  const setValue = useSettingsStore((s) => s.set);
  const initial = useMemo(() => buildSnapshot(values), [values]);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const dirty = draft !== initial;

  const save = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Top-level value must be an object.");
      return;
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    for (const [k, v] of entries) {
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        setError(`Value for "${k}" must be a string, number, or boolean.`);
        return;
      }
    }
    // Apply each key. Unknown keys are accepted (forward compatibility);
    // they round-trip through the store without breaking.
    for (const [k, v] of entries) {
      setValue(k as SettingsKey, v as SettingsValue);
    }
    setError(null);
    onClose();
  };

  const reset = () => {
    setDraft(initial);
    setError(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard blocked
    }
  };

  return (
    <div data-testid="settings-json-editor" className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 -ml-2">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to settings
        </Button>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy JSON"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="mb-2">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">settings.json</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Live view of every key in the settings store. Edit the JSON and Save to apply.
        </p>
      </div>

      <textarea
        data-testid="settings-json-textarea"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        className="min-h-0 flex-1 resize-none rounded-lg bg-card/40 p-4 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        style={{ border: "1px solid hsl(var(--border))" }}
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-xs">
          {error ? (
            <span data-testid="settings-json-error" className="text-destructive">
              {error}
            </span>
          ) : dirty ? (
            <span className="text-muted-foreground">Unsaved changes</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button variant="ghost" size="sm" onClick={reset} data-testid="settings-json-reset">
              Discard
            </Button>
          ) : null}
          <Button
            variant="default"
            size="sm"
            onClick={save}
            disabled={!dirty}
            data-testid="settings-json-save"
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
