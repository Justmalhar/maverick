import { useCallback, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { skillsListGlobal } from "@/lib/tauri";
import { useWorkbench } from "@/state/store";

function SkillRow({ name, description }: { name: string; description: string }) {
  return (
    <div
      data-testid={`skills-panel-row-${name}`}
      className="flex items-start gap-3 rounded-md px-4 py-2.5 hover:bg-muted/50"
    >
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">{name}</p>
        {description && (
          <p className="truncate text-[11px] text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

export default function SkillsPanel() {
  const skills = useWorkbench((s) => s.skills);
  const setSkills = useWorkbench((s) => s.setSkills);
  const openSystemTab = useWorkbench((s) => s.openSystemTab);
  const reduce = useReducedMotion();

  const refresh = useCallback(async () => {
    try {
      setSkills(await skillsListGlobal());
    } catch (e) {
      console.error("skillsListGlobal failed", e);
    }
  }, [setSkills]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <motion.div
      data-testid="skills-panel"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Skills</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={refresh} data-testid="skills-panel-refresh">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openSystemTab("skill-editor")}
            data-testid="skills-panel-new"
          >
            <Plus className="h-3 w-3" />
            New Skill
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {skills.length === 0 ? (
          <div
            data-testid="skills-panel-empty"
            className="flex flex-col items-center gap-3 px-6 py-12 text-center"
          >
            <Sparkles className="h-8 w-8 text-muted-foreground/40" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">No skills yet</p>
              <p className="text-[11px] text-muted-foreground/70">
                Drop a <code className="font-mono">skill.md</code> into{" "}
                <code className="font-mono">~/.maverick/skills/</code> or click New Skill.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-2">
            {skills.map((s) => (
              <SkillRow key={s.name} name={s.name} description={s.description} />
            ))}
          </div>
        )}
      </ScrollArea>
    </motion.div>
  );
}
