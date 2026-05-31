import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/stores/settings";
import { appVersion, appCommit, versionLabel } from "@/lib/build-info";
import { useUpdater, type UpdaterStatus } from "@/hooks/useUpdater";

const CHANNELS = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
  { value: "nightly", label: "Nightly" },
];

const APP_VERSION = appVersion();
const COMMIT = appCommit();

function statusMessage(status: UpdaterStatus, available: string | undefined): string {
  switch (status) {
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking…";
    case "uptodate":
      return "Up to date";
    case "available":
      return available ? `Update available: ${available}` : "Update available";
    case "installing":
      return "Downloading and installing…";
    case "unconfigured":
      return "Updates are not configured for this build.";
    case "error":
      return "Check failed.";
  }
}

export default function VersionSettings() {
  const [channel, setChannel] = useSettings("version.updateChannel", "stable");
  const [copied, setCopied] = useState(false);
  const { status, update, error, checkNow, installAndRestart } = useUpdater();

  const copyVersion = async () => {
    try {
      await navigator.clipboard.writeText(versionLabel());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  };

  const busy = status === "checking" || status === "installing";

  return (
    <div data-testid="version-settings" className="space-y-5">
      <SettingsGroup title="Build">
        <SettingsRow
          title="Maverick"
          description="App version and build identifier."
          control={
            <div className="flex items-center gap-2 font-mono text-xs">
              <span data-testid="version-string">
                {APP_VERSION} <span className="text-muted-foreground">({COMMIT})</span>
              </span>
              <button
                type="button"
                onClick={copyVersion}
                aria-label="Copy version"
                className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          }
        />
        <SettingsRow
          title="Status"
          description="Most recent check against the update channel."
          control={
            <span
              data-testid="version-status"
              className={
                status === "error"
                  ? "text-xs text-destructive"
                  : status === "available"
                    ? "text-xs text-accent"
                    : "text-xs text-muted-foreground"
              }
            >
              {statusMessage(status, update?.version)}
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Updates">
        <SettingsRow
          title="Update channel"
          description="Beta and Nightly receive new features sooner, with rougher edges."
          control={
            <SettingsSelect
              label="Update channel"
              value={channel}
              onValueChange={setChannel}
              options={CHANNELS}
              data-testid="version-channel"
            />
          }
        />
        <SettingsRow
          title="Check for updates"
          description="Fetch release manifest from the channel above."
          control={
            status === "available" || status === "installing" ? (
              <Button
                variant="default"
                size="sm"
                data-testid="version-install"
                disabled={busy}
                onClick={() => void installAndRestart()}
              >
                {status === "installing" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Install &amp; restart
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                data-testid="version-check"
                disabled={busy}
                onClick={() => void checkNow()}
              >
                {status === "checking" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Check now
              </Button>
            )
          }
        />
        {status === "error" && error ? (
          <SettingsRow
            title="Error"
            description="The last update check did not complete."
            control={
              <span data-testid="version-error" className="text-xs text-destructive">
                {error}
              </span>
            }
          />
        ) : null}
      </SettingsGroup>
    </div>
  );
}
