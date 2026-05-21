// Default backend, default branch, workspace naming, startup behaviour.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function GeneralSettings() {
  const [defaultBackend, setDefaultBackend] = useState("claude");
  const [defaultBranch, setDefaultBranch] = useState("origin/main");
  const [namingScheme, setNamingScheme] = useState("{branch}");
  const [restoreSession, setRestoreSession] = useState(true);

  return (
    <section data-testid="general-settings" className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">General</h3>
      <Row label="Default backend">
        <Input
          data-testid="general-default-backend"
          value={defaultBackend}
          onChange={(e) => setDefaultBackend(e.target.value)}
        />
      </Row>
      <Row label="Default base branch">
        <Input
          data-testid="general-default-branch"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
        />
      </Row>
      <Row label="Workspace naming scheme">
        <Input
          data-testid="general-naming"
          value={namingScheme}
          onChange={(e) => setNamingScheme(e.target.value)}
          placeholder="{branch} or {backend}-{date}"
        />
      </Row>
      <Row label="Restore last session on startup">
        <Button
          variant={restoreSession ? "default" : "outline"}
          size="sm"
          onClick={() => setRestoreSession((s) => !s)}
          data-testid="general-restore"
        >
          {restoreSession ? "On" : "Off"}
        </Button>
      </Row>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
