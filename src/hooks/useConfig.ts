import { useEffect, useState } from "react";
import { configLoad } from "@/lib/tauri";
import type { MaverickConfig } from "@/lib/ipc";

export function useConfig(projectPath: string | null) {
  const [config, setConfig] = useState<MaverickConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setConfig(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    configLoad(projectPath)
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  return { config, loading, error };
}
