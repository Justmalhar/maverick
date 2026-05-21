import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { useSettings } from "@/lib/stores/settings";

const CHANNELS = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
];

export default function AccountSettings() {
  const [license, setLicense] = useSettings("account.licenseKey", "");
  const [channel, setChannel] = useSettings("account.updateChannel", "stable");
  const plan = license.length > 0 ? "Pro" : "Free";

  return (
    <div data-testid="account-settings" className="space-y-5">
      <SettingsGroup title="License">
        <SettingsRow
          title="License key"
          description="Stored locally. Paste a key to upgrade to Pro."
          control={
            <Input
              type="password"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              data-testid="account-license"
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Plan"
          control={
            <span className="text-xs text-foreground" data-testid="account-plan">
              {plan}
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Updates">
        <SettingsRow
          title="Update channel"
          description="Beta gets new features first, but with rougher edges."
          control={
            <SettingsSelect
              label="Update channel"
              value={channel}
              onValueChange={setChannel}
              options={CHANNELS}
              data-testid="account-channel"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
