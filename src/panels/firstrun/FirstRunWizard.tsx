import { useFirstRun } from "@/hooks/useFirstRun";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { WelcomeStep } from "./steps/WelcomeStep";
import { PermissionsStep } from "./steps/PermissionsStep";
import { ThemeStep } from "./steps/ThemeStep";
import { BackendStep } from "./steps/BackendStep";

const LABELS = ["Welcome", "Permissions", "Theme", "Backend"] as const;

export function FirstRunWizard() {
  const ctrl = useFirstRun();
  if (!ctrl.open || !ctrl.status) return null;

  const StepBody = (() => {
    switch (ctrl.step) {
      case 1: return <WelcomeStep status={ctrl.status} />;
      case 2: return <PermissionsStep status={ctrl.status} onAdvance={ctrl.advance} />;
      case 3: return <ThemeStep />;
      case 4: return <BackendStep />;
    }
  })();

  const isFirst = ctrl.step === 1;
  const isLast = ctrl.step === 4;

  return (
    <motion.div
      data-testid="firstrun-wizard"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-overlay flex items-center justify-center bg-background/95 backdrop-blur"
    >
      <div className="flex w-full max-w-2xl flex-col gap-6 rounded-lg border border-border bg-card p-8 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {LABELS.map((label, i) => {
              const n = (i + 1) as 1 | 2 | 3 | 4;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 rounded-full",
                      n === ctrl.step ? "bg-primary" : n < ctrl.step ? "bg-primary/50" : "bg-muted"
                    )}
                  />
                  <span className={cn("text-[11px]", n === ctrl.step ? "text-foreground" : "text-muted-foreground")}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
          <span data-testid="firstrun-step-indicator" className="text-[11px] text-muted-foreground">
            Step {ctrl.step} / 4
          </span>
        </div>

        <div className="min-h-[280px]">{StepBody}</div>

        <div className="flex items-center justify-end gap-2">
          {!isFirst && (
            <Button
              variant="ghost"
              size="sm"
              onClick={isLast ? () => void ctrl.complete() : ctrl.advance}
            >
              Skip
            </Button>
          )}
          {!isFirst && (
            <Button variant="ghost" size="sm" onClick={ctrl.back}>
              Back
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={isLast ? () => void ctrl.complete() : ctrl.advance}
          >
            {isLast ? "Get started" : "Continue"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
