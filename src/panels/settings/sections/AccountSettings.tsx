// Account: license key, plan info, update channel.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AccountSettings() {
  const [license, setLicense] = useState("");
  const [channel, setChannel] = useState<"stable" | "beta">("stable");

  return (
    <section data-testid="account-settings" className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Account</h3>
      <Row label="License key">
        <Input
          type="password"
          value={license}
          onChange={(e) => setLicense(e.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          data-testid="account-license"
        />
      </Row>
      <Row label="Plan">
        <span className="text-xs text-foreground" data-testid="account-plan">
          {license ? "Pro" : "Free"}
        </span>
      </Row>
      <Row label="Update channel">
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={channel === "stable" ? "default" : "outline"}
            onClick={() => setChannel("stable")}
            data-testid="channel-stable"
          >
            Stable
          </Button>
          <Button
            size="sm"
            variant={channel === "beta" ? "default" : "outline"}
            onClick={() => setChannel("beta")}
            data-testid="channel-beta"
          >
            Beta
          </Button>
        </div>
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
