import { Check } from "lucide-react";
import { useFirstRun, WIZARD_STEP_COUNT, type WizardStep } from "@/hooks/useFirstRun";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { WelcomeStep } from "./steps/WelcomeStep";
import { PermissionsStep } from "./steps/PermissionsStep";
import { ThemeStep } from "./steps/ThemeStep";
import { InstructionsStep } from "./steps/InstructionsStep";
import { BackendStep } from "./steps/BackendStep";

const LABELS = ["Welcome", "Notifications", "Theme", "Instructions", "Backend"] as const;

interface StepDotProps {
  index: WizardStep;
  current: WizardStep;
  label: string;
  isLast: boolean;
}

function StepDot({ index, current, label, isLast }: StepDotProps) {
  const done = index < current;
  const active = index === current;
  // Line is the next-step "edge": connector becomes "done" once we're past `index`.
  const lineDone = index < current;
  return (
    <div
      className="flex flex-1 items-start"
      data-testid={`wizard-step-dot-${index}`}
    >
      <div className="flex flex-col items-center gap-1.5">
        <div
          aria-current={active ? "step" : undefined}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium transition-colors",
            done && "bg-primary text-primary-foreground",
            active && "bg-primary text-primary-foreground ring-2 ring-primary/30",
            !done && !active && "bg-muted-foreground/20 text-muted-foreground"
          )}
        >
          {done ? <Check className="h-3 w-3" strokeWidth={3} /> : index}
        </div>
        <span
          className={cn(
            "text-[10px] leading-none",
            active ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
      </div>
      {!isLast && (
        // mt-[11px] aligns the 2px line with the center of the 24px dot above.
        <div
          data-testid={`wizard-step-line-${index}`}
          className={cn(
            "mx-2 mt-[11px] h-0.5 flex-1 rounded-full transition-colors",
            lineDone ? "bg-primary/70" : "bg-muted-foreground/30"
          )}
        />
      )}
    </div>
  );
}

export function FirstRunWizard() {
  const ctrl = useFirstRun();
  if (!ctrl.open || !ctrl.status) return null;

  const StepBody = (() => {
    switch (ctrl.step) {
      case 1: return <WelcomeStep status={ctrl.status} />;
      case 2: return <PermissionsStep status={ctrl.status} onAdvance={ctrl.advance} />;
      case 3: return <ThemeStep />;
      case 4: return <InstructionsStep />;
      case 5: return <BackendStep />;
    }
  })();

  const isFirst = ctrl.step === 1;
  const isLast = ctrl.step === WIZARD_STEP_COUNT;

  return (
    <motion.div
      data-testid="firstrun-wizard"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-overlay flex items-center justify-center bg-background/95 backdrop-blur"
    >
      <div className="flex w-full max-w-2xl flex-col gap-8 rounded-lg border border-border bg-card p-8 shadow-md">
        {/* Step indicator */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-1 items-start">
            {LABELS.map((label, i) => {
              const n = (i + 1) as WizardStep;
              return (
                <StepDot
                  key={label}
                  index={n}
                  current={ctrl.step}
                  label={label}
                  isLast={i === LABELS.length - 1}
                />
              );
            })}
          </div>
          <span
            data-testid="firstrun-step-indicator"
            className="shrink-0 self-start pt-0.5 text-[11px] text-muted-foreground"
          >
            Step {ctrl.step} / {WIZARD_STEP_COUNT}
          </span>
        </div>

        {/* Body — extra top margin away from the step indicator */}
        <div className="min-h-[320px] pt-2">{StepBody}</div>

        {/* Footer: Skip on the left, Back + Continue on the right */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center">
            {!isFirst && (
              <Button
                variant="ghost"
                size="sm"
                onClick={isLast ? () => void ctrl.complete() : ctrl.advance}
              >
                Skip
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
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
      </div>
    </motion.div>
  );
}
