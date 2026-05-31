import { useState, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkbench } from "@/state/store";
import { gitBranches } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/lib/ipc";

export interface ComposerPayload {
  prompt: string;
  projectId: string;
  branch: string;
  agentBackend: string;
  attachments: Attachment[];
}

interface Props {
  onSend: (payload: ComposerPayload) => Promise<void>;
  defaultProjectId?: string | null;
}

export default function TaskComposer({ onSend, defaultProjectId }: Props) {
  const projects = useWorkbench((s) => s.projects);
  const backends = useWorkbench((s) => s.backends);
  const activeWorkspace = useWorkbench((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId)
  );

  const [prompt, setPrompt] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(
    activeWorkspace?.projectId ?? ""
  );
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBackendId, setSelectedBackendId] = useState(
    backends.find((b) => b.active)?.id ?? backends[0]?.id ?? ""
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const fetchBranches = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      setIsLoadingBranches(true);
      setBranchError(null);
      setSelectedBranch("");
      try {
        const b = await gitBranches(project.path);
        setBranches(Array.isArray(b) ? b : []);
      } catch {
        setBranchError("Could not load branches");
        setBranches([]);
      } finally {
        setIsLoadingBranches(false);
      }
    },
    [projects]
  );

  useEffect(() => {
    if (!defaultProjectId) return;
    setSelectedProjectId(defaultProjectId);
    fetchBranches(defaultProjectId);
  }, [defaultProjectId, fetchBranches]);

  const handleProjectChange = (id: string) => {
    setSelectedProjectId(id);
    fetchBranches(id);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text");
    if (text.length > 1000) {
      e.preventDefault();
      const name = `pasted_${format(new Date(), "ddMMyyyyHHmm")}.txt`;
      setAttachments((prev) => [
        ...prev,
        {
          name,
          content: text,
          encoding: "utf8",
          size: new TextEncoder().encode(text).byteLength,
        },
      ]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.size > 2 * 1024 * 1024) {
        setError(`File too large (max 2 MB): ${file.name}`);
        continue;
      }
      const isText =
        file.type.startsWith("text/") ||
        file.name.endsWith(".txt") ||
        file.name.endsWith(".md");
      if (isText) {
        const content = await file.text();
        setAttachments((prev) => [
          ...prev,
          { name: file.name, content, encoding: "utf8", size: file.size },
        ]);
      } else {
        const buffer = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        setAttachments((prev) => [
          ...prev,
          { name: file.name, content: base64, encoding: "base64", size: file.size },
        ]);
      }
    }
  };

  const removeAttachment = (index: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index));

  const canSend =
    prompt.trim().length > 0 &&
    !!selectedProjectId &&
    !!selectedBranch &&
    !!selectedBackendId &&
    !isSending;

  const handleSend = async () => {
    if (!canSend) return;
    setIsSending(true);
    setError(null);
    try {
      await onSend({
        prompt: prompt.trim(),
        projectId: selectedProjectId,
        branch: selectedBranch,
        agentBackend: selectedBackendId,
        attachments,
      });
      setPrompt("");
      setAttachments([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      data-testid="task-composer"
      className={cn(
        "border-b border-border/60 bg-card/30 px-4 py-3",
        isDraggingOver && "ring-1 ring-inset ring-primary"
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
        Task Composer
      </p>

      <textarea
        data-testid="composer-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => e.key === "Enter" && e.metaKey && handleSend()}
        placeholder="What needs to be done?"
        rows={2}
        className="w-full resize-none rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{ maxHeight: "12rem" } as React.CSSProperties}
      />

      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {attachments.map((a, i) => (
            <span
              key={i}
              data-testid="composer-attachment"
              className="flex items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground"
            >
              <Paperclip className="h-2.5 w-2.5" />
              {a.name}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                data-testid="composer-remove-attachment"
                className="ml-0.5 hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Select value={selectedProjectId} onValueChange={handleProjectChange}>
          <SelectTrigger className="h-7 w-36 border-border/50 text-[11px]" data-testid="composer-project">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-[11px]">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedBranch}
          onValueChange={setSelectedBranch}
          disabled={!selectedProjectId || isLoadingBranches}
        >
          <SelectTrigger className="h-7 w-40 border-border/50 text-[11px]" data-testid="composer-branch">
            <SelectValue
              placeholder={
                isLoadingBranches ? "Loading…" : (branchError ?? "Branch / Worktree")
              }
            />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b} value={b} className="text-[11px]">
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedBackendId} onValueChange={setSelectedBackendId}>
          <SelectTrigger className="h-7 w-32 border-border/50 text-[11px]" data-testid="composer-agent">
            <SelectValue placeholder="Agent" />
          </SelectTrigger>
          <SelectContent>
            {backends.map((b) => (
              <SelectItem key={b.id} value={b.id} className="text-[11px]">
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          onClick={handleSend}
          disabled={!canSend}
          data-testid="composer-send"
          className="ml-auto h-7 gap-1.5 px-4 text-[11px]"
        >
          <Send className="h-3 w-3" />
          Send
        </Button>
      </div>

      {error && (
        <div data-testid="composer-error" className="mt-1.5 text-[10px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
