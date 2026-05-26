import { useCallback, useEffect, useState } from "react";
import {
  bootstrapStatus,
  bootstrapComplete,
  resetFirstRun,
} from "@/lib/tauri";
import type { BootstrapStatus } from "@/lib/ipc";

export interface FirstRunController {
  open: boolean;
  step: 1 | 2 | 3 | 4;
  status: BootstrapStatus | null;
  advance: () => void;
  back: () => void;
  goTo: (step: 1 | 2 | 3 | 4) => void;
  refresh: () => Promise<void>;
  complete: () => Promise<void>;
  reset: () => Promise<void>;
}

export function useFirstRun(): FirstRunController {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const refresh = useCallback(async () => {
    const s = await bootstrapStatus();
    setStatus(s);
    setOpen(s.firstRun);
    setStep(1);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const advance = useCallback(() => {
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }, []);

  const back = useCallback(() => {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));
  }, []);

  const goTo = useCallback((s: 1 | 2 | 3 | 4) => setStep(s), []);

  const complete = useCallback(async () => {
    await bootstrapComplete();
    setOpen(false);
    await refresh();
  }, [refresh]);

  const reset = useCallback(async () => {
    await resetFirstRun();
    await refresh();
  }, [refresh]);

  return { open, step, status, advance, back, goTo, refresh, complete, reset };
}
