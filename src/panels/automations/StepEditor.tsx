// Per-type form: shell / skill / git / workspace / notify / url.
import { Input } from "@/components/ui/input";
import type { AutomationStep } from "@/lib/ipc";

interface Props {
  step: AutomationStep;
  onChange: (next: AutomationStep) => void;
}

function set<T extends AutomationStep>(step: T, patch: Partial<T>): T {
  return { ...step, ...patch };
}

export default function StepEditor({ step, onChange }: Props) {
  switch (step.type) {
    case "shell":
      return (
        <Field label="Command">
          <Input
            data-testid="step-shell-command"
            value={String(step.command ?? "")}
            onChange={(e) => onChange(set(step, { command: e.target.value }))}
            placeholder="bun run build"
          />
        </Field>
      );
    case "skill":
      return (
        <Field label="Skill name">
          <Input
            data-testid="step-skill-name"
            value={String(step.skill ?? "")}
            onChange={(e) => onChange(set(step, { skill: e.target.value }))}
            placeholder="review"
          />
        </Field>
      );
    case "git":
      return (
        <div className="space-y-1.5">
          <Field label="Action">
            <Input
              data-testid="step-git-action"
              value={String(step.action ?? "")}
              onChange={(e) => onChange(set(step, { action: e.target.value }))}
              placeholder="push | pull | commit"
            />
          </Field>
          <Field label="Remote">
            <Input
              data-testid="step-git-remote"
              value={String(step.remote ?? "")}
              onChange={(e) => onChange(set(step, { remote: e.target.value }))}
              placeholder="origin"
            />
          </Field>
          <Field label="Branch">
            <Input
              data-testid="step-git-branch"
              value={String(step.branch ?? "")}
              onChange={(e) => onChange(set(step, { branch: e.target.value }))}
              placeholder="main"
            />
          </Field>
        </div>
      );
    case "workspace":
      return (
        <div className="space-y-1.5">
          <Field label="Action">
            <Input
              data-testid="step-workspace-action"
              value={String(step.action ?? "")}
              onChange={(e) => onChange(set(step, { action: e.target.value }))}
              placeholder="create | destroy"
            />
          </Field>
          <Field label="Branch">
            <Input
              data-testid="step-workspace-branch"
              value={String(step.branch ?? "")}
              onChange={(e) => onChange(set(step, { branch: e.target.value }))}
            />
          </Field>
        </div>
      );
    case "notify":
      return (
        <div className="space-y-1.5">
          <Field label="Title">
            <Input
              data-testid="step-notify-title"
              value={String(step.title ?? "")}
              onChange={(e) => onChange(set(step, { title: e.target.value }))}
            />
          </Field>
          <Field label="Body">
            <Input
              data-testid="step-notify-body"
              value={String(step.body ?? "")}
              onChange={(e) => onChange(set(step, { body: e.target.value }))}
            />
          </Field>
        </div>
      );
    case "url":
      return (
        <Field label="URL">
          <Input
            data-testid="step-url"
            value={String(step.url ?? "")}
            onChange={(e) => onChange(set(step, { url: e.target.value }))}
            placeholder="https://example.com"
          />
        </Field>
      );
    default:
      return null;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
