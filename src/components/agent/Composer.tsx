import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import type { AgentCapabilities, AgentPart, Workspace } from "@/lib/ipc";
import {
  agentCapabilities, agentInterrupt, agentQueueRemove, agentSend, agentSetOptions,
} from "@/lib/tauri";
import { useAgentStore, emptySession } from "@/state/agent-store";
import { ModelMenu, ReasoningMenu } from "./ComposerMenus";

interface Props { workspace: Workspace; }

export function Composer({ workspace }: Props) {
  const sessionId = workspace.sessionId;
  const slice = useAgentStore((s) => s.sessions[sessionId]) ?? emptySession();
  const setOptionsLocal = useAgentStore((s) => s.setOptionsLocal);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Extract<AgentPart, { type: "attachment" }>[]>([]);
  const [caps, setCaps] = useState<AgentCapabilities | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const working = slice.status === "working";

  useEffect(() => {
    let cancelled = false;
    agentCapabilities(workspace.id)
      .then((c) => { if (!cancelled) setCaps(c); })
      .catch((e) => console.error("[agent] capabilities failed", e));
    return () => { cancelled = true; };
  }, [workspace.id]);

  function interrupt() {
    agentInterrupt(sessionId).catch((e) => console.error("[agent] interrupt failed", e));
  }

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function send() {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    const parts: AgentPart[] = [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...attachments,
    ];
    setDraft("");
    setAttachments([]);
    requestAnimationFrame(autoGrow);
    try {
      await agentSend(sessionId, parts);
    } catch (e) {
      console.error("[agent] send failed", e);
    }
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Escape lives on the composer root so it bubbles from any focused
  // descendant (e.g. the Stop button), yet stays scoped to this composer —
  // a window listener would fire for inactive keep-alive-mounted workspaces.
  function onRootKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && working) {
      e.preventDefault();
      interrupt();
    }
  }

  function selectModel(id: string) {
    setOptionsLocal(sessionId, { model: id });
    agentSetOptions(sessionId, { model: id }).catch((e) => console.error("[agent] set options failed", e));
  }

  function selectReasoning(id: string) {
    setOptionsLocal(sessionId, { reasoningLevel: id });
    agentSetOptions(sessionId, { reasoningLevel: id }).catch((e) => console.error("[agent] set options failed", e));
  }

  return (
    <div className="mv-composer flex shrink-0 flex-col gap-2 border-t border-border bg-editor p-3" data-testid="agent-composer" onKeyDown={onRootKeyDown}>
      {slice.queue.length > 0 && (
        <div className="flex flex-col gap-1">
          {slice.queue.map((q) => (
            <div key={q.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground">
              <span className="flex-1 truncate">
                {q.parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join(" ")}
              </span>
              <span className="text-[10px] uppercase tracking-wide">queued</span>
              <button
                type="button"
                aria-label="Remove queued message"
                onClick={() => agentQueueRemove(sessionId, q.id).catch((e) => console.error("[agent] queue remove failed", e))}
                className="flex h-4 w-4 items-center justify-center rounded-sm hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* TODO(agent-mode plan Task 14): attachment populate path lands with drop/paste */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span key={a.path} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              <span className="max-w-[200px] truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove attachment ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                className="flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card focus-within:border-accent/50">
        <textarea
          ref={textareaRef}
          aria-label="Message agent"
          value={draft}
          rows={2}
          onChange={(e) => { setDraft(e.target.value); autoGrow(); }}
          onKeyDown={onTextareaKeyDown}
          placeholder="Ask to make changes, @mention files, run /commands"
          className="max-h-[200px] w-full resize-none bg-transparent px-3 pt-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <ModelMenu value={slice.model} options={caps?.models ?? []} onSelect={selectModel} />
          <ReasoningMenu value={slice.reasoningLevel} options={caps?.reasoningLevels ?? []} onSelect={selectReasoning} />
          <div className="flex-1" />
          {working ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={interrupt}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground transition-colors duration-100 hover:bg-destructive/20 hover:text-destructive"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={!draft.trim() && attachments.length === 0}
              onClick={() => void send()}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors duration-100 hover:bg-accent/90 disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
