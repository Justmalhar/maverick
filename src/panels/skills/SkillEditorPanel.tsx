import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { skillsCreateGlobal, skillsListGlobal } from "@/lib/tauri";
import { useWorkbench } from "@/state/store";

const SKILL_TEMPLATE = `---
name: my-skill
description: Brief description of what this skill does
backend: claude-code
---

Write your skill prompt here.

You can reference dynamic values with {{variable_name}} syntax.
`;

function parseFrontmatter(content: string): {
  name: string;
  description: string;
  prompt: string;
  backend?: string;
} | null {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) return null;
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  if (!fm.name) return null;
  return {
    name: fm.name,
    description: fm.description ?? "",
    prompt: match[2].trim(),
    backend: fm.backend,
  };
}

export default function SkillEditorPanel() {
  const [content, setContent] = useState(SKILL_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeSystemTab = useWorkbench((s) => s.closeSystemTab);
  const setSkills = useWorkbench((s) => s.setSkills);
  const reduce = useReducedMotion();

  async function save() {
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      setError("Could not parse frontmatter — make sure name: is set.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await skillsCreateGlobal(parsed.name, parsed.description, parsed.prompt, parsed.backend);
      const updated = await skillsListGlobal();
      setSkills(updated);
      closeSystemTab("skill-editor");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      data-testid="skill-editor-panel"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          New Skill — <code className="font-mono normal-case">~/.maverick/skills/</code>
        </span>
        <div className="flex items-center gap-1.5">
          {error && (
            <span
              data-testid="skill-editor-error"
              className="text-[11px] text-destructive"
            >
              {error}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => closeSystemTab("skill-editor")}
            data-testid="skill-editor-cancel"
          >
            <X className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={save}
            disabled={saving}
            data-testid="skill-editor-save"
          >
            <Save className="h-3 w-3" />
            Save
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          data-testid="skill-editor-textarea"
          className="h-full w-full resize-none rounded-md border border-border bg-muted/30 p-3 font-mono text-[13px] leading-relaxed text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </div>
    </motion.div>
  );
}
