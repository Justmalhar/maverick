import type { BootstrapStatus } from "@/lib/ipc";
export function PermissionsStep({ status: _status, onAdvance: _onAdvance }: { status: BootstrapStatus; onAdvance: () => void }) {
  return <div data-testid="firstrun-step-permissions" />;
}
