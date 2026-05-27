import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Send, Sparkles, X } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { useSettings } from "@/lib/stores/settings";
import { attachmentCreate } from "@/lib/tauri";
import type { Workspace } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
  onSubmit: (text: string) => void;
  onBackendChange?: (backendId: string) => void;
}

interface AttachmentChip {
  ref: string;
  size: number;
}

function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}

export function InputBar({ workspace, onSubmit, onBackendChange }: Props) {
  const skills = useWorkbench((s) => s.skills);
  const backends = useWorkbench((s) => s.backends);
  const [largeTextThreshold] = useSettings("advanced.largeTextThreshold", 5000);
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillIndex, setSkillIndex] = useState(0);
  const [selectedBackend, setSelectedBackend] = useState(workspace.agentBackend);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.toLowerCase();
    return skills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [skills, skillQuery]);

  useEffect(() => {
    const match = /(?:^|\s)\/(\S*)$/.exec(value);
    if (match) {
      setSkillOpen(true);
      setSkillQuery(match[1] ?? "");
      setSkillIndex(0);
    } else {
      setSkillOpen(false);
    }
  }, [value]);

  useEffect(() => {
    function onInputAppend(e: Event) {
      const detail = (e as CustomEvent<{ text: string } | string>).detail;
      const text = typeof detail === "string" ? detail : detail?.text ?? "";
      if (!text) return;
      setValue((v) => (v ? `${v}\n${text}` : text));
      inputRef.current?.focus();
    }
    window.addEventListener("maverick:input-append", onInputAppend);
    return () => window.removeEventListener("maverick:input-append", onInputAppend);
  }, []);

  function applySkill(name: string) {
    setValue((v) => v.replace(/\/(\S*)$/, `/${name} `));
    setSkillOpen(false);
    inputRef.current?.focus();
  }

  function submit() {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
    setAttachments([]);
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text");
    if (pasted.length <= largeTextThreshold) return;
    e.preventDefault();
    // Capture the caret synchronously — the synthetic event is recycled after await.
    const { selectionStart: start, selectionEnd: end } = e.currentTarget;
    try {
      const result = await attachmentCreate(workspace.worktreePath, pasted);
      setValue((v) => `${v.slice(0, start)}${result.ref}${v.slice(end)}`);
      setAttachments((prev) => [...prev, { ref: result.ref, size: pasted.length }]);
    } catch (err) {
      console.error("attachment create failed", err);
    }
  }

  function removeAttachment(ref: string) {
    setAttachments((prev) => prev.filter((a) => a.ref !== ref));
    setValue((v) => v.replace(ref, "").replace(/\s{2,}/g, " ").trimStart());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (skillOpen && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSkillIndex((i) => (i + 1) % filteredSkills.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSkillIndex(
          (i) => (i - 1 + filteredSkills.length) % filteredSkills.length
        );
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const skill = filteredSkills[skillIndex];
        if (skill) applySkill(skill.name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSkillOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !skillOpen) {
      e.preventDefault();
      submit();
    }
  }

  function handleBackendChange(id: string) {
    setSelectedBackend(id);
    onBackendChange?.(id);
  }

  return (
    <div
      data-testid="input-bar"
      className="mv-input-bar relative border-t border-border bg-editor px-3 py-2"
    >
      {skillOpen && filteredSkills.length > 0 && (
        <ul
          data-testid="skill-autocomplete"
          className="absolute bottom-full left-3 right-3 mb-1 max-h-40 overflow-auto rounded-sm border border-border bg-popover p-1 text-xs shadow-md"
        >
          {filteredSkills.map((s, i) => (
            <li
              key={s.name}
              onMouseDown={(e) => {
                e.preventDefault();
                applySkill(s.name);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1",
                i === skillIndex && "bg-sidebar-hover text-foreground"
              )}
            >
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="font-mono text-foreground">/{s.name}</span>
              <span className="truncate text-muted-foreground">
                {s.description}
              </span>
            </li>
          ))}
        </ul>
      )}

      {attachments.length > 0 && (
        <ul
          data-testid="attachment-chips"
          className="mb-1.5 flex flex-wrap gap-1.5"
        >
          {attachments.map((a) => (
            <li
              key={a.ref}
              data-testid={`attachment-chip-${a.ref}`}
              className="flex items-center gap-1.5 rounded-sm border border-border bg-card/60 px-2 py-1 text-[11px] text-foreground"
            >
              <Paperclip className="h-3 w-3 text-primary" />
              <span className="font-mono">{a.ref}</span>
              <span className="text-muted-foreground">{formatChars(a.size)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.ref)}
                aria-label={`Remove ${a.ref}`}
                data-testid={`attachment-remove-${a.ref}`}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 rounded-sm border border-border bg-input px-2 py-1.5 transition-colors duration-100 focus-within:border-primary">
        <textarea
          ref={inputRef}
          data-input-bar
          aria-label="Prompt input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          placeholder={`Message ${selectedBackend} — use /skill for templates`}
          className="flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          style={{ maxHeight: 160 }}
        />
        {backends.length > 1 && (
          <Select value={selectedBackend} onValueChange={handleBackendChange}>
            <SelectTrigger
              className="h-6 w-20 shrink-0 border-border/50 text-[11px]"
              data-testid="input-backend-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {backends.map((b) => (
                <SelectItem key={b.id} value={b.id} className="text-[11px]">
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="default"
          size="icon-sm"
          onClick={submit}
          aria-label="Send"
          data-testid="input-send"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          <kbd className="font-mono">Enter</kbd> send ·{" "}
          <kbd className="font-mono">Shift+Enter</kbd> newline
        </span>
        <span>0 / 200k tokens</span>
      </div>
    </div>
  );
}
