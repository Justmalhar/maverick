import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/stores/settings";

const APP_VERSION = "0.1.0";
const COMMIT = "cc-ui/settings-redesign";

const CHANNELS = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
  { value: "nightly", label: "Nightly" },
];

export default function VersionSettings() {
  const [channel, setChannel] = useSettings("version.updateChannel", "stable");
  const [copied, setCopied] = useState(false);

  const copyVersion = async () => {
    try {
      await navigator.clipboard.writeText(`Maverick ${APP_VERSION} (${COMMIT})`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  };

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
          control={<span className="text-xs text-muted-foreground">Up to date</span>}
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
            <Button variant="outline" size="sm" data-testid="version-check">
              Check now
            </Button>
          }
        />
      </SettingsGroup>
    </div>
  );
}
