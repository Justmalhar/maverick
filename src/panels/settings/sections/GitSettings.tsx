import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";
import { gitCredentialStatus } from "@/lib/tauri";
import type { CredentialProvider, CredentialStatus } from "@/lib/ipc";
import { ConnectHostDialog } from "@/components/auxiliarybar/ConnectHostDialog";

const ACCOUNT_PROVIDERS: { id: CredentialProvider; label: string }[] = [
  { id: "github", label: "GitHub" },
  { id: "bitbucket", label: "Bitbucket" },
  { id: "gitlab", label: "GitLab" },
];

export default function GitSettings() {
  const [remote, setRemote] = useSettings("git.remote", "origin");
  const [template, setTemplate] = useSettings("git.template", "");
  const [autoFetch, setAutoFetch] = useSettings("git.autoFetchMinutes", 5);
  const [gpg, setGpg] = useSettings("git.gpgSign", false);

  const [accounts, setAccounts] = useState<Partial<Record<CredentialProvider, CredentialStatus>>>({});
  const [dialogProvider, setDialogProvider] = useState<CredentialProvider | null>(null);

  const refreshAccounts = useCallback(async () => {
    const results = await Promise.all(
      ACCOUNT_PROVIDERS.map(async ({ id }) => {
        try {
          const status = await gitCredentialStatus(id);
          return status ?? ({ provider: id, connected: false } as CredentialStatus);
        } catch {
          return { provider: id, connected: false } satisfies CredentialStatus;
        }
      })
    );
    setAccounts(Object.fromEntries(results.map((s) => [s.provider, s])));
  }, []);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  return (
    <div data-testid="git-settings" className="space-y-5">
      <SettingsGroup
        title="Connected accounts"
        description="Authenticate a git host over HTTPS so Push, Pull, and Create PR work. The credential is saved in your system git credential helper — Maverick never stores it."
      >
        {ACCOUNT_PROVIDERS.map(({ id, label }) => {
          const connected = accounts[id]?.connected ?? false;
          const username = accounts[id]?.username;
          return (
            <SettingsRow
              key={id}
              title={label}
              description={
                connected
                  ? `Connected${username ? ` as ${username}` : ""}.`
                  : "Not connected."
              }
              control={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogProvider(id)}
                  data-testid={`git-account-${id}`}
                >
                  {connected ? (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5 text-success" />
                      Manage
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              }
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Remote">
        <SettingsRow
          title="Default remote"
          description="Used by Push / Pull and 'Auto-fetch'."
          control={
            <Input
              data-testid="git-remote"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Auto-fetch interval"
          description="Minutes between background `git fetch`. Set to 0 to disable."
          control={
            <Input
              type="number"
              min={0}
              data-testid="git-autofetch"
              value={autoFetch}
              onChange={(e) => setAutoFetch(Number(e.target.value))}
              className="max-w-[120px]"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Commits">
        <SettingsRow
          title="Commit message template"
          description="Prefilled into the message buffer when staging a commit."
          control={
            <textarea
              data-testid="git-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={3}
              className="w-full max-w-lg resize-none rounded-sm bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              style={{ border: "1px solid hsl(var(--border))" }}
            />
          }
        />
        <SettingsRow
          title="GPG signing"
          description="Sign every commit with the configured GPG key."
          control={
            <SettingsToggle
              label="GPG signing"
              checked={gpg}
              onCheckedChange={setGpg}
              data-testid="git-gpg"
            />
          }
        />
      </SettingsGroup>

      <ConnectHostDialog
        open={dialogProvider !== null}
        onOpenChange={(o) => !o && setDialogProvider(null)}
        defaultProvider={dialogProvider ?? "github"}
        onChanged={() => void refreshAccounts()}
      />
    </div>
  );
}
