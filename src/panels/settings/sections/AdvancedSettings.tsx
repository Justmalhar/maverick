import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";

export default function AdvancedSettings() {
  const [largeText, setLargeText] = useSettings("advanced.largeTextThreshold", 5000);
  const [lruLimit, setLruLimit] = useSettings("advanced.lruLimit", 8);
  const [caffeinate, setCaffeinate] = useSettings("advanced.caffeinate", true);
  const [telemetry, setTelemetry] = useSettings("advanced.telemetry", false);

  return (
    <div data-testid="advanced-settings" className="space-y-5">
      <SettingsGroup title="Performance">
        <SettingsRow
          title="Large text threshold"
          description="Characters above which we render a single-line preview instead of the full file."
          control={
            <Input
              type="number"
              min={500}
              data-testid="advanced-largetext"
              value={largeText}
              onChange={(e) => setLargeText(Number(e.target.value))}
              className="max-w-[140px]"
            />
          }
        />
        <SettingsRow
          title="LRU workspace limit"
          description="Number of inactive workspaces kept hot in memory."
          control={
            <Input
              type="number"
              min={1}
              data-testid="advanced-lru"
              value={lruLimit}
              onChange={(e) => setLruLimit(Number(e.target.value))}
              className="max-w-[140px]"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="System">
        <SettingsRow
          title="Caffeinate while agents are running"
          description="Prevent the system from sleeping when any agent process is active."
          control={
            <SettingsToggle
              label="Caffeinate"
              checked={caffeinate}
              onCheckedChange={setCaffeinate}
              data-testid="advanced-caffeinate"
            />
          }
        />
        <SettingsRow
          title="Telemetry"
          description="Anonymous usage metrics. Off by default."
          control={
            <SettingsToggle
              label="Telemetry"
              checked={telemetry}
              onCheckedChange={setTelemetry}
              data-testid="advanced-telemetry"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
