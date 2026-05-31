import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { useGlobalEnv } from "@/lib/stores/settings";

interface Pair {
  key: string;
  value: string;
}

function toPairs(env: Record<string, string>): Pair[] {
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

// Drop blank keys and last-wins on duplicates so the persisted map stays clean.
function toEnv(pairs: Pair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const k = key.trim();
    if (k !== "") out[k] = value;
  }
  return out;
}

// Stable identity for an env map: a JSON object key-sorted so equal maps with
// differing insertion order compare equal. Used to detect external changes.
function envSignature(env: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) sorted[key] = env[key];
  return JSON.stringify(sorted);
}

export default function EnvironmentSettings() {
  const [env, setEnv] = useGlobalEnv();
  // Local working copy keeps blank/duplicate rows editable; commit derives the map.
  const [pairs, setPairs] = useState<Pair[]>(() => toPairs(env));
  // Signature of the env we last committed, so our own writes don't trigger a
  // re-sync that would wipe in-progress blank rows.
  const lastCommittedRef = useRef(envSignature(toEnv(pairs)));

  const commit = (next: Pair[]) => {
    setPairs(next);
    const map = toEnv(next);
    lastCommittedRef.current = envSignature(map);
    setEnv(map);
  };

  // Re-sync local rows when the store env diverges from our own last write
  // (e.g. another surface or an import updates global env while open).
  const envSig = envSignature(env);
  useEffect(() => {
    if (envSig === lastCommittedRef.current) return;
    lastCommittedRef.current = envSig;
    setPairs(toPairs(env));
    // env is fully captured by its signature; depend on the primitive only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envSig]);

  const updateAt = (index: number, patch: Partial<Pair>) =>
    commit(pairs.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const removeAt = (index: number) => commit(pairs.filter((_, i) => i !== index));

  const addRow = () => setPairs((prev) => [...prev, { key: "", value: "" }]);

  return (
    <div data-testid="environment-settings" className="space-y-5">
      <SettingsGroup
        title="Global environment variables"
        description="Injected into every terminal and agent PTY. Per-project or per-workspace values override these when keys collide. Never store secrets here that you would not keep in plain text."
      >
        <div className="space-y-2 py-4">
          {pairs.length === 0 ? (
            <p data-testid="environment-empty" className="text-xs text-muted-foreground">
              No variables yet.
            </p>
          ) : (
            pairs.map((pair, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`Variable name ${index + 1}`}
                  data-testid={`environment-key-${index}`}
                  value={pair.key}
                  placeholder="NAME"
                  onChange={(e) => updateAt(index, { key: e.target.value })}
                  className="max-w-[200px] font-mono"
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  aria-label={`Variable value ${index + 1}`}
                  data-testid={`environment-value-${index}`}
                  value={pair.value}
                  placeholder="value"
                  onChange={(e) => updateAt(index, { value: e.target.value })}
                  className="flex-1 font-mono"
                />
                <button
                  type="button"
                  aria-label={`Remove variable ${index + 1}`}
                  data-testid={`environment-remove-${index}`}
                  onClick={() => removeAt(index)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            data-testid="environment-add"
            onClick={addRow}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Add variable
          </button>
        </div>
      </SettingsGroup>
    </div>
  );
}
