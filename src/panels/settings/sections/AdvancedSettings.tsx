// Large text threshold, LRU workspace limit, caffeinate toggle, telemetry opt-out.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AdvancedSettings() {
  const [largeText, setLargeText] = useState(5000);
  const [lruLimit, setLruLimit] = useState(8);
  const [caffeinate, setCaffeinate] = useState(true);
  const [telemetry, setTelemetry] = useState(false);

  return (
    <section data-testid="advanced-settings" className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Advanced</h3>
      <Row label="Large text threshold (chars)">
        <Input
          type="number"
          min={500}
          data-testid="advanced-largetext"
          value={largeText}
          onChange={(e) => setLargeText(Number(e.target.value))}
        />
      </Row>
      <Row label="LRU workspace limit">
        <Input
          type="number"
          min={1}
          data-testid="advanced-lru"
          value={lruLimit}
          onChange={(e) => setLruLimit(Number(e.target.value))}
        />
      </Row>
      <Row label="Caffeinate while agents running">
        <Button
          variant={caffeinate ? "default" : "outline"}
          size="sm"
          onClick={() => setCaffeinate((s) => !s)}
          data-testid="advanced-caffeinate"
        >
          {caffeinate ? "On" : "Off"}
        </Button>
      </Row>
      <Row label="Telemetry">
        <Button
          variant={telemetry ? "default" : "outline"}
          size="sm"
          onClick={() => setTelemetry((s) => !s)}
          data-testid="advanced-telemetry"
        >
          {telemetry ? "On" : "Off"}
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
