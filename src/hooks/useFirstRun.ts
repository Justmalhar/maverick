import { useCallback, useEffect, useState } from "react";
import {
  bootstrapStatus,
  bootstrapComplete,
  resetFirstRun,
} from "@/lib/tauri";
import type { BootstrapStatus } from "@/lib/ipc";

export type WizardStep = 1 | 2 | 3 | 4 | 5;
export const WIZARD_STEP_COUNT = 5;

export interface FirstRunController {
  open: boolean;
  step: WizardStep;
  status: BootstrapStatus | null;
  advance: () => void;
  back: () => void;
  goTo: (step: WizardStep) => void;
  refresh: () => Promise<void>;
  complete: () => Promise<void>;
  reset: () => Promise<void>;
}

export function useFirstRun(): FirstRunController {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);

  const refresh = useCallback(async () => {
    try {
      const s = await bootstrapStatus();
      setStatus(s);
      setOpen(s.firstRun);
      setStep(1);
    } catch (err) {
      console.error("[useFirstRun] bootstrap_status failed:", err);
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener("maverick:firstrun:reset", handler);
    return () => window.removeEventListener("maverick:firstrun:reset", handler);
  }, [refresh]);

  const advance = useCallback(() => {
    setStep((s) => (s < WIZARD_STEP_COUNT ? ((s + 1) as WizardStep) : s));
  }, []);

  const back = useCallback(() => {
    setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s));
  }, []);

  const goTo = useCallback((s: WizardStep) => setStep(s), []);

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
