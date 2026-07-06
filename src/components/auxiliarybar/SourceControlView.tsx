// VSCode/Conductor-style source control: branch selector, Commit & Push split
// button + Git actions menu, collapsible Changes + Commit History.
import { useCallback, useEffect, useState } from "react";
import { Check, GitBranch, Plug, RefreshCw } from "lucide-react";
import { useWorkbench, selectContextWorkspace } from "@/state/store";
import { joinPath } from "@/lib/paths";
import { renameWorkspaceBranchWithAI } from "@/lib/ai-rename";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { getGitTemplate, getSettingBool } from "@/lib/stores/settings";
import { useSourceControl } from "@/hooks/useSourceControl";
import { buildCreatePrPrompt, canDispatchAgentAction, sendAgentPrompt } from "@/lib/ai-actions";
import {
  aiCommitMessage,
  diffGet,
  gitBranchCreate,
  gitCheckout,
  gitCommit,
  gitCredentialStatus,
  gitRemoteInfo,
  prCreate,
} from "@/lib/tauri";
import type { CredentialProvider, DiffFile, GitProvider, RemoteInfo } from "@/lib/ipc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ConnectHostDialog } from "./ConnectHostDialog";
import { BranchSelector } from "./scm/BranchSelector";
import { CommitBox } from "./scm/CommitBox";
import { CommitActions } from "./scm/CommitActions";
import { ChangesSection } from "./scm/ChangesSection";
import { CommitHistorySection } from "./scm/CommitHistorySection";

function credentialProviderFor(provider: GitProvider | undefined): CredentialProvider | null {
  return provider && provider !== "unknown" ? provider : null;
}
function looksLikeAuthError(text: string): boolean {
  return /authentication|credential|permission denied|rejected the credentials|could not read (?:username|password)/i.test(text);
}
const PROVIDER_LABEL = { github: "GitHub", bitbucket: "Bitbucket", gitlab: "GitLab", unknown: "Git" } as const;

type Busy = "none" | "generate" | "commit" | "pr";
interface Feedback { tone: "info" | "error"; text: string; url?: string; }

export function SourceControlView() {
  const active = useWorkbench(selectContextWorkspace);
  const openFileTab = useWorkbench((s) => s.openFileTab);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const prefs = useProjectSettingsStore((s) => s.data?.preferences);
  const scm = useSourceControl(active?.worktreePath ?? null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [busy, setBusy] = useState<Busy>("none");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const credProvider = credentialProviderFor(remote?.provider);

  const refreshAuth = useCallback(async (provider: CredentialProvider | null) => {
    if (!provider) { setConnected(false); return; }
    try { setConnected((await gitCredentialStatus(provider)).connected); } catch { setConnected(false); }
  }, []);

  const refreshFiles = useCallback(async () => {
    if (!active?.worktreePath) return;
    const [diff, info] = await Promise.all([
      diffGet(active.worktreePath).catch(() => null),
      gitRemoteInfo(active.worktreePath).catch(() => null),
    ]);
    const list = diff?.files ?? [];
    setFiles(list);
    setSelected(new Set(list.map((f) => f.path)));
    setRemote(info);
  }, [active?.worktreePath]);

  useEffect(() => { setFeedback(null); setMessage(getGitTemplate()); void refreshFiles(); }, [refreshFiles]);
  useEffect(() => { void refreshAuth(credProvider); }, [credProvider, refreshAuth]);

  if (!active) {
    return (
      <div data-testid="scm-empty" className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <GitBranch className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-[13px] text-foreground">No active workspace</span>
        <p className="max-w-xs text-xs text-muted-foreground">Open a workspace to commit, push, and create pull requests.</p>
      </div>
    );
  }
  const ws = active;

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function onOpenDiff(relPath: string) {
    openFileTab({ kind: "diff", path: joinPath(ws.worktreePath, relPath), worktreePath: ws.worktreePath, preview: true });
  }

  async function run(kind: Busy, action: () => Promise<Feedback | null>) {
    if (busy !== "none") return;
    setBusy(kind); setFeedback(null);
    try { const r = await action(); if (r) setFeedback(r); }
    catch (e) { setFeedback({ tone: "error", text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy("none"); }
  }

  const onGenerate = () => run("generate", async () => {
    const { message: g } = await aiCommitMessage(ws.worktreePath, ws.agentBackend);
    setMessage(g);
    return null;
  });

  async function doCommit(): Promise<string | null> {
    if (!message.trim()) { setFeedback({ tone: "error", text: "Enter a commit message first." }); return null; }
    if (selected.size === 0) { setFeedback({ tone: "error", text: "Select at least one file." }); return null; }
    const { sha } = await gitCommit(ws.worktreePath, message.trim(), [...selected], getSettingBool("git.gpgSign"));
    setMessage(getGitTemplate());
    await refreshFiles();
    await scm.refresh();
    const wb = useWorkbench.getState();
    if (wb.pendingAiRename.includes(ws.id)) {
      const newBranch = await renameWorkspaceBranchWithAI({ worktreePath: ws.worktreePath, instructions: prefs?.branchRename, backend: ws.agentBackend });
      wb.clearPendingAiRename(ws.id);
      if (newBranch) { wb.updateWorkspace(ws.id, { branch: newBranch }); await scm.refresh({ remote: "never" }); }
    }
    return sha;
  }

  const onCommit = () => run("commit", async () => {
    const sha = await doCommit();
    return sha ? { tone: "info", text: `Committed ${sha.slice(0, 7)}` } : null;
  });

  const onCommitAndPush = () => run("commit", async () => {
    const sha = await doCommit();
    if (!sha) return null;
    const r = await scm.runRemoteAction("push");
    if (!r.ok) return { tone: "error", text: r.error ?? "Committed, but push failed." };
    return { tone: "info", text: `Committed ${sha.slice(0, 7)} · pushed` };
  });

  const onPush = async () => {
    setFeedback(null);
    const r = await scm.runRemoteAction("push");
    setFeedback(r.ok ? { tone: "info", text: "Pushed." } : { tone: "error", text: r.error ?? "Push blocked." });
  };
  const onPull = async () => {
    setFeedback(null);
    const r = await scm.runRemoteAction("pull");
    if (r.ok) { setFeedback({ tone: "info", text: "Pulled." }); await refreshFiles(); }
    else setFeedback({ tone: "error", text: r.error ?? "Pull blocked." });
  };
  const onSync = async () => {
    setFeedback(null);
    const r = await scm.runRemoteAction("contextual");
    if (r.ok) { setFeedback({ tone: "info", text: "Synced." }); await refreshFiles(); }
    else if (r.blocked) setFeedback({ tone: "error", text: "Nothing to sync." });
    else setFeedback({ tone: "error", text: r.error ?? "Sync failed." });
  };

  const onCreatePr = () => run("pr", async () => {
    const { url } = await prCreate(ws.worktreePath, { backend: ws.agentBackend, instructions: prefs?.createPr });
    await scm.refresh();
    return { tone: "info", text: "Pull request:", url };
  });

  const onCreatePrWithAgent = async () => {
    const target = { workspaceId: ws.id, backend: ws.agentBackend, cwd: ws.worktreePath };
    if (!canDispatchAgentAction(target)) {
      setFeedback({ tone: "error", text: "No live agent for this workspace." });
      return;
    }
    const diff = await diffGet(ws.worktreePath).catch(() => ({ files: [] }));
    await sendAgentPrompt({
      target,
      prompt: buildCreatePrPrompt(diff, prefs?.createPr, prefs?.general, { remote: "origin" }),
      onAgentFocus: () => setActiveWorkspace(ws.id),
    });
  };

  const onCreateBranch = async () => {
    const name = window.prompt("New branch name");
    if (!name?.trim()) return;
    await run("commit", async () => {
      await gitBranchCreate(ws.worktreePath, name.trim());
      await gitCheckout(ws.worktreePath, name.trim());
      await scm.refresh({ remote: "never" });
      return { tone: "info", text: `Created ${name.trim()}` };
    });
  };

  const anyBusy = busy !== "none" || scm.busyAction !== null;
  const canAgentPr = canDispatchAgentAction({ workspaceId: ws.id, backend: ws.agentBackend, cwd: ws.worktreePath });
  const primaryLabel: "Commit" | "Commit & Push" = scm.branch?.upstream || scm.ahead > 0 ? "Commit & Push" : "Commit";

  return (
    <div className="mv-scm flex h-full flex-col" data-testid="scm-view">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <BranchSelector
          worktreePath={ws.worktreePath}
          currentName={scm.branch?.name ?? ws.branch}
          ahead={scm.ahead}
          behind={scm.behind}
          onChanged={() => { void refreshFiles(); void scm.refresh({ remote: "always" }); }}
        />
        {credProvider ? (
          <button
            type="button"
            onClick={() => setConnectOpen(true)}
            data-testid="scm-connect"
            title={connected ? `${PROVIDER_LABEL[credProvider]} connected` : `Connect ${PROVIDER_LABEL[credProvider]}`}
            className={cn("ml-auto flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] transition-colors duration-100 hover:bg-sidebar-hover", connected ? "text-success" : "text-muted-foreground hover:text-foreground")}
          >
            {connected ? <Check className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
            {connected ? PROVIDER_LABEL[credProvider] : `Connect ${PROVIDER_LABEL[credProvider]}`}
          </button>
        ) : (
          <span className="ml-auto text-[10px] text-muted-foreground" data-testid="scm-provider">{PROVIDER_LABEL[remote?.provider ?? "unknown"]}</span>
        )}
        <button type="button" onClick={() => { void refreshFiles(); void scm.refresh({ remote: "always" }); }} aria-label="Refresh" data-testid="scm-refresh" className="flex h-5 w-5 items-center justify-center rounded-sm text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground">
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <CommitBox
          value={message}
          onChange={setMessage}
          onGenerate={() => void onGenerate()}
          onSubmit={() => void onCommit()}
          generating={busy === "generate"}
          disabled={anyBusy}
          placeholder="Commit message (⌘Enter to commit)"
        />
        <CommitActions
          primaryLabel={primaryLabel}
          canCommit={!anyBusy && files.length > 0}
          busy={busy === "commit"}
          anyBusy={anyBusy}
          canAgentPr={canAgentPr}
          onCommit={() => void onCommit()}
          onCommitAndPush={() => void onCommitAndPush()}
          onPull={() => void onPull()}
          onPush={() => void onPush()}
          onSync={() => void onSync()}
          onCreatePr={() => void onCreatePr()}
          onCreatePrWithAgent={() => void onCreatePrWithAgent()}
          onCreateBranch={() => void onCreateBranch()}
        />
        {feedback && (
          <div className="flex items-center gap-2">
            <p data-testid="scm-feedback" className={cn("min-w-0 flex-1 truncate text-[11px]", feedback.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
              {feedback.text}{" "}
              {feedback.url && (
                <a href={feedback.url} target="_blank" rel="noreferrer" data-testid="scm-pr-link" className="text-info underline">{feedback.url}</a>
              )}
            </p>
            {feedback.tone === "error" && credProvider && looksLikeAuthError(feedback.text) && (
              <button type="button" onClick={() => setConnectOpen(true)} data-testid="scm-feedback-connect" className="flex shrink-0 items-center gap-1 rounded-sm bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-foreground transition-colors duration-100 hover:bg-accent/30">
                <Plug className="h-3 w-3" /> Connect {PROVIDER_LABEL[credProvider]}
              </button>
            )}
          </div>
        )}
      </div>

      {files.length === 0 ? (
        <div data-testid="scm-clean" className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <GitBranch className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-[13px] text-foreground">Working tree clean</span>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ChangesSection files={files} selected={selected} onToggle={toggle} onOpenDiff={onOpenDiff} />
        </ScrollArea>
      )}

      <CommitHistorySection worktreePath={ws.worktreePath} />

      <ConnectHostDialog open={connectOpen} onOpenChange={setConnectOpen} defaultProvider={credProvider ?? "github"} onChanged={() => void refreshAuth(credProvider)} />
    </div>
  );
}
