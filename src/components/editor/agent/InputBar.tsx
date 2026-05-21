import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { useWorkbench } from "@/state/store";
import type { Workspace } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
  onSubmit: (text: string) => void;
}

export function InputBar({ workspace, onSubmit }: Props) {
  const skills = useWorkbench((s) => s.skills);
  const [value, setValue] = useState("");
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillIndex, setSkillIndex] = useState(0);
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

  function applySkill(name: string) {
    setValue((v) => v.replace(/\/(\S*)$/, `/${name} `));
    setSkillOpen(false);
    inputRef.current?.focus();
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
      const text = value.trim();
      if (!text) return;
      onSubmit(text);
      setValue("");
    }
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

      <div className="flex items-end gap-2 rounded-sm border border-border bg-input px-2 py-1.5 transition-colors duration-100 focus-within:border-primary">
        <textarea
          ref={inputRef}
          data-input-bar
          aria-label="Prompt input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={`Message ${workspace.agentBackend} — use /skill for templates`}
          className="flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          style={{ maxHeight: 160 }}
        />
        <Button
          variant="default"
          size="icon-sm"
          onClick={() => {
            const text = value.trim();
            if (!text) return;
            onSubmit(text);
            setValue("");
          }}
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
