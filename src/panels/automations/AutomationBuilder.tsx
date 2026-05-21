// Visual step editor — add step, choose type, configure per type.
import { Plus, GripVertical, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Automation, AutomationStep } from "@/lib/ipc";
import StepEditor from "./StepEditor";

interface Props {
  automation: Automation;
  onChange: (next: Automation) => void;
}

type StepType = AutomationStep["type"];

const STEP_TYPES: StepType[] = ["shell", "skill", "git", "workspace", "notify", "url"];

function defaultStep(type: StepType): AutomationStep {
  switch (type) {
    case "shell":
      return { type, command: "" } as AutomationStep;
    case "skill":
      return { type, skill: "" } as AutomationStep;
    case "git":
      return { type, action: "push" } as AutomationStep;
    case "workspace":
      return { type, action: "create" } as AutomationStep;
    case "notify":
      return { type, title: "", body: "" } as AutomationStep;
    case "url":
      return { type, url: "" } as AutomationStep;
  }
}

export default function AutomationBuilder({ automation, onChange }: Props) {
  const updateStep = (index: number, next: AutomationStep) => {
    const steps = [...automation.steps];
    steps[index] = next;
    onChange({ ...automation, steps });
  };

  const removeStep = (index: number) => {
    onChange({ ...automation, steps: automation.steps.filter((_, i) => i !== index) });
  };

  const addStep = (type: StepType) => {
    onChange({ ...automation, steps: [...automation.steps, defaultStep(type)] });
  };

  return (
    <div data-testid="automation-builder" className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Input
          data-testid="automation-name"
          value={automation.name}
          onChange={(e) => onChange({ ...automation, name: e.target.value })}
          className="max-w-[200px]"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" data-testid="automation-trigger">
              Trigger: {automation.trigger}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {(["manual", "schedule", "on-file-change"] as Automation["trigger"][]).map((t) => (
              <DropdownMenuItem
                key={t}
                onClick={() => onChange({ ...automation, trigger: t })}
              >
                {t}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="default" data-testid="automation-add-step">
              <Plus className="h-3 w-3" />
              Add step
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {STEP_TYPES.map((t) => (
              <DropdownMenuItem key={t} onClick={() => addStep(t)}>
                {t}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex-1">
        {automation.steps.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            No steps yet — add one to begin.
          </div>
        ) : (
          automation.steps.map((step, idx) => (
            <div
              key={idx}
              data-testid="automation-step"
              className="border-b border-border/40 p-2"
            >
              <div className="mb-1 flex items-center gap-1.5">
                <GripVertical className="h-3 w-3 text-muted-foreground" />
                <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                  {step.type}
                </span>
                <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeStep(idx)}
                  data-testid="automation-step-remove"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <StepEditor step={step} onChange={(next) => updateStep(idx, next)} />
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  );
}
