import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Plug } from "lucide-react";
import {
  gitCredentialConnect,
  gitCredentialDisconnect,
  gitCredentialStatus,
} from "@/lib/tauri";
import type { CredentialProvider, CredentialStatus } from "@/lib/ipc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProviderMeta {
  label: string;
  // Where the user creates an app password / token, and what to call the secret.
  tokenUrl: string;
  secretLabel: string;
}

const PROVIDERS: Record<CredentialProvider, ProviderMeta> = {
  github: {
    label: "GitHub",
    tokenUrl: "https://github.com/settings/tokens",
    secretLabel: "Personal access token",
  },
  bitbucket: {
    label: "Bitbucket",
    tokenUrl: "https://bitbucket.org/account/settings/app-passwords/",
    secretLabel: "App password",
  },
  gitlab: {
    label: "GitLab",
    tokenUrl: "https://gitlab.com/-/user_settings/personal_access_tokens",
    secretLabel: "Personal access token",
  },
};

const ORDER: CredentialProvider[] = ["github", "bitbucket", "gitlab"];

export function ConnectHostDialog({
  open,
  onOpenChange,
  defaultProvider = "github",
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProvider?: CredentialProvider;
  onChanged?: () => void;
}) {
  const [provider, setProvider] = useState<CredentialProvider>(defaultProvider);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [busy, setBusy] = useState<"check" | "connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = PROVIDERS[provider];

  const refreshStatus = useCallback(async (p: CredentialProvider) => {
    setBusy("check");
    setError(null);
    try {
      setStatus(await gitCredentialStatus(p));
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  // Reset to the remote's provider each time the dialog opens, then load status.
  useEffect(() => {
    if (!open) return;
    setProvider(defaultProvider);
    setUsername("");
    setPassword("");
  }, [open, defaultProvider]);

  useEffect(() => {
    if (!open) return;
    void refreshStatus(provider);
  }, [open, provider, refreshStatus]);

  const onConnect = async () => {
    setBusy("connect");
    setError(null);
    try {
      await gitCredentialConnect(provider, username.trim(), password);
      setPassword("");
      await refreshStatus(provider);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onDisconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      await gitCredentialDisconnect(provider, status?.username);
      await refreshStatus(provider);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const anyBusy = busy !== null;
  const connected = status?.connected ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="connect-host-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Plug className="h-4 w-4 text-accent" />
            Connect a git host
          </DialogTitle>
          <DialogDescription className="text-xs">
            Authenticate over HTTPS. The credential is saved in your system git
            credential helper — Maverick never stores it.
          </DialogDescription>
        </DialogHeader>

        {/* Provider selector */}
        <div className="flex gap-1.5" role="tablist" aria-label="Git host">
          {ORDER.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={provider === p}
              data-testid={`connect-provider-${p}`}
              onClick={() => setProvider(p)}
              disabled={anyBusy}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors duration-100 disabled:opacity-60",
                provider === p
                  ? "bg-accent/20 text-foreground"
                  : "bg-sidebar-hover text-muted-foreground hover:text-foreground"
              )}
            >
              {PROVIDERS[p].label}
            </button>
          ))}
        </div>

        {connected ? (
          <div
            className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-[12px] text-foreground"
            data-testid="connect-status-connected"
          >
            <Check className="h-3.5 w-3.5 text-success" />
            Connected to {meta.label}
            {status?.username ? ` as ${status.username}` : ""}.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              {meta.label} username
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                data-testid="connect-username"
                className="font-mono text-[12px]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              {meta.secretLabel}
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                data-testid="connect-password"
                className="font-mono text-[12px]"
              />
            </label>
            <a
              href={meta.tokenUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="connect-token-link"
              className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
            >
              Create a {meta.secretLabel.toLowerCase()}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {error && (
          <p className="text-[11px] text-destructive" data-testid="connect-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onDisconnect()}
              disabled={anyBusy}
              data-testid="connect-disconnect"
            >
              {busy === "disconnect" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void onConnect()}
              disabled={anyBusy || !username.trim() || !password}
              data-testid="connect-submit"
            >
              {busy === "connect" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Connect
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
