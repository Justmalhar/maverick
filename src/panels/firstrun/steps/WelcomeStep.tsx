import type { BootstrapStatus } from "@/lib/ipc";
export function WelcomeStep({ status: _status }: { status: BootstrapStatus }) {
  return <div data-testid="firstrun-step-welcome" />;
}
