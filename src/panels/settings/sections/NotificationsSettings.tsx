import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";
import type { SettingsKey } from "@/lib/ipc";

interface NotifSetting {
  key: SettingsKey;
  label: string;
  description: string;
}

const NOTIFS: NotifSetting[] = [
  { key: "notifications.agent.waiting", label: "Agent waiting for input", description: "Notify when an agent pauses for stdin." },
  { key: "notifications.agent.complete", label: "Agent task complete", description: "Summary when a task finishes." },
  { key: "notifications.agent.error", label: "Agent error / crash", description: "Red notification on failure." },
  { key: "notifications.build.result", label: "Build / test result", description: "Pass/fail notification when run scripts complete." },
  { key: "notifications.quota.warning", label: "Quota warning", description: "Notify at 80% and 100% of quota." },
];

function NotifToggle({ s }: { s: NotifSetting }) {
  const [checked, setChecked] = useSettings(s.key, true);
  return (
    <SettingsRow
      title={s.label}
      description={s.description}
      control={
        <SettingsToggle
          label={s.label}
          checked={checked}
          onCheckedChange={setChecked}
          data-testid={`notif-${s.key}`}
        />
      }
    />
  );
}

export default function NotificationsSettings() {
  return (
    <div data-testid="notifications-settings" className="space-y-5">
      <SettingsGroup>
        {NOTIFS.map((s) => (
          <NotifToggle key={s.key} s={s} />
        ))}
      </SettingsGroup>
    </div>
  );
}
