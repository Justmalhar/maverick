// ⌘⇧G — full git UI: log, stage/commit, stash, blame, branches, conflicts
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { GitBranch as GitBranchIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import CommitLog from "./CommitLog";
import StagingArea from "./StagingArea";
import StashList from "./StashList";
import BlameView from "./BlameView";
import BranchList from "./BranchList";
import ConflictResolver from "./ConflictResolver";
import CherryPickDialog from "./CherryPickDialog";
import { Button } from "@/components/ui/button";

export type GitTab = "log" | "staging" | "stash" | "branches" | "blame" | "conflicts";

export default function GitPanel() {
  const active = useWorkbench(selectActiveWorkspace);
  const [tab, setTab] = useState<GitTab>("log");
  const [cherryPickOpen, setCherryPickOpen] = useState(false);
  const reduce = useReducedMotion();

  // Auto-flip to "conflicts" tab if workspace status indicates trouble
  useEffect(() => {
    if (active?.status === "error") setTab("conflicts");
  }, [active?.status]);

  const worktreePath = useMemo(() => active?.worktreePath ?? "", [active?.worktreePath]);

  if (!active) {
    return (
      <div
        data-testid="git-panel-empty"
        className="flex h-full w-full items-center justify-center text-xs text-muted-foreground"
      >
        <div className="flex flex-col items-center gap-2">
          <GitBranchIcon className="h-5 w-5 opacity-50" />
          <span>Select a workspace to view Git</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      data-testid="git-panel"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="flex h-full w-full flex-col bg-background text-foreground"
    >
      <div className="flex items-center justify-between border-b border-border px-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as GitTab)} className="flex-1">
          <TabsList className="border-b-0">
            <TabsTrigger value="log" data-testid="git-tab-log">Log</TabsTrigger>
            <TabsTrigger value="staging" data-testid="git-tab-staging">Staging</TabsTrigger>
            <TabsTrigger value="stash" data-testid="git-tab-stash">Stash</TabsTrigger>
            <TabsTrigger value="branches" data-testid="git-tab-branches">Branches</TabsTrigger>
            <TabsTrigger value="blame" data-testid="git-tab-blame">Blame</TabsTrigger>
            <TabsTrigger value="conflicts" data-testid="git-tab-conflicts">Conflicts</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCherryPickOpen(true)}
          data-testid="git-cherrypick-open"
        >
          Cherry-pick
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "log" && <CommitLog worktreePath={worktreePath} />}
        {tab === "staging" && <StagingArea worktreePath={worktreePath} />}
        {tab === "stash" && <StashList worktreePath={worktreePath} />}
        {tab === "branches" && <BranchList worktreePath={worktreePath} />}
        {tab === "blame" && <BlameView worktreePath={worktreePath} />}
        {tab === "conflicts" && <ConflictResolver worktreePath={worktreePath} />}
      </div>

      <CherryPickDialog
        open={cherryPickOpen}
        onOpenChange={setCherryPickOpen}
        worktreePath={worktreePath}
      />
    </motion.div>
  );
}
