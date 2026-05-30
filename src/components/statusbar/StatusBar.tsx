import {
  AlertCircle,
  AlertTriangle,
  GitBranch,
  RefreshCw,
  Check,
} from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { useContextUsage } from "@/hooks/useContextUsage";
import { formatTokens } from "@/lib/context-usage";
import { StatusBarItem } from "./StatusBarItem";
import { NotificationBell } from "./NotificationBell";
import { CaffeinateToggle } from "./CaffeinateToggle";

export function StatusBar() {
  const backends = useWorkbench((s) => s.backends);
  const active = useWorkbench(selectActiveWorkspace);
  const workspaceCount = useWorkbench((s) => s.workspaces.length);
  const activeBackend = backends.find((b) => b.active);
  const usage = useContextUsage(active?.sessionId);

  return (
    <footer
      data-testid="statusbar"
      className="mv-statusbar relative z-base flex w-full shrink-0 items-center justify-between bg-statusbar text-statusbar-fg"
      style={{ height: "var(--statusbar-height)" }}
    >
      <div className="flex h-full items-center">
        {active ? (
          <StatusBarItem
            icon={<GitBranch className="h-3 w-3" />}
            testId="statusbar-branch"
          >
            {active.branch}
          </StatusBarItem>
        ) : (
          <StatusBarItem testId="statusbar-no-folder">No folder</StatusBarItem>
        )}
        {active && (
          <StatusBarItem
            icon={<RefreshCw className="h-3 w-3" />}
            testId="statusbar-sync"
          >
            sync
          </StatusBarItem>
        )}
        <StatusBarItem
          icon={<AlertCircle className="h-3 w-3" />}
          testId="statusbar-errors"
        >
          0
        </StatusBarItem>
        <StatusBarItem
          icon={<AlertTriangle className="h-3 w-3" />}
          testId="statusbar-warnings"
        >
          0
        </StatusBarItem>
      </div>

      <div className="flex h-full items-center">
        <StatusBarItem testId="statusbar-position">Ln 1, Col 1</StatusBarItem>
        <StatusBarItem testId="statusbar-encoding">UTF-8</StatusBarItem>
        <StatusBarItem testId="statusbar-eol">LF</StatusBarItem>
        <StatusBarItem testId="statusbar-language">
          {active ? active.agentBackend : "plaintext"}
        </StatusBarItem>
        <StatusBarItem testId="statusbar-tokens">
          {active
            ? `~${formatTokens(usage.tokensUsed)} tok · $${usage.sessionCostEstimate.toFixed(2)}`
            : "0 tokens"}
        </StatusBarItem>
        <CaffeinateToggle />
        <StatusBarItem
          icon={<Check className="h-3 w-3" />}
          testId="statusbar-backends"
        >
          {activeBackend
            ? activeBackend.name
            : backends.length === 0
              ? "no backends"
              : `${backends.length} backends`}
        </StatusBarItem>
        <StatusBarItem testId="statusbar-workspaces">
          {workspaceCount} ws
        </StatusBarItem>
        <NotificationBell />
      </div>
    </footer>
  );
}
