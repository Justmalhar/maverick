import { Folder, Database, FileText, ScrollText } from "lucide-react";
import type { BootstrapStatus } from "@/lib/ipc";

interface PathRowProps {
  icon: typeof Folder;
  label: string;
  path: string;
}

function PathRow({ icon: Icon, label, path }: PathRowProps) {
  function copy() {
    void navigator.clipboard.writeText(path);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-[12px] hover:bg-muted"
    >
      <span className="flex items-center gap-2 text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{path}</span>
    </button>
  );
}

export function WelcomeStep({ status }: { status: BootstrapStatus }) {
  const { paths } = status;
  return (
    <div data-testid="firstrun-step-welcome" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Welcome to Maverick</h2>
        <p className="text-[12px] text-muted-foreground">
          Maverick has set up the following on this machine. You can edit files inside
          <span className="font-mono"> ~/.maverick </span> at any time.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <PathRow icon={Folder} label="Config root" path={paths.configRoot} />
        <PathRow icon={ScrollText} label="Themes & instructions" path={`${paths.configRoot}/themes`} />
        <PathRow icon={FileText} label="Global instructions" path={`${paths.configRoot}/GLOBAL.md`} />
        <PathRow icon={Database} label="Database" path={paths.dbPath} />
        <PathRow icon={Folder} label="Logs" path={paths.logsDir} />
      </div>
      <p className="text-[11px] text-muted-foreground">Click any row to copy its path.</p>
    </div>
  );
}
