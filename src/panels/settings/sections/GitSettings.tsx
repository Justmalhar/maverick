// Git settings: remote, commit template, auto-fetch, GPG signing.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function GitSettings() {
  const [remote, setRemote] = useState("origin");
  const [template, setTemplate] = useState("");
  const [autoFetch, setAutoFetch] = useState(5);
  const [gpg, setGpg] = useState(false);

  return (
    <section data-testid="git-settings" className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Git</h3>
      <Row label="Default remote">
        <Input
          data-testid="git-remote"
          value={remote}
          onChange={(e) => setRemote(e.target.value)}
        />
      </Row>
      <Row label="Commit message template">
        <textarea
          data-testid="git-template"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-sm border border-border bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </Row>
      <Row label="Auto-fetch interval (minutes)">
        <Input
          type="number"
          min={0}
          data-testid="git-autofetch"
          value={autoFetch}
          onChange={(e) => setAutoFetch(Number(e.target.value))}
        />
      </Row>
      <Row label="GPG signing">
        <Button
          variant={gpg ? "default" : "outline"}
          size="sm"
          onClick={() => setGpg((s) => !s)}
          data-testid="git-gpg"
        >
          {gpg ? "On" : "Off"}
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
