import { useEffect } from "react";
import { useWorkbench } from "@/state/store";
import { skillsList, skillsRun } from "@/lib/tauri";
import type { Skill } from "@/lib/ipc";

export function useSkills(projectPath?: string | null) {
  const skills = useWorkbench((s) => s.skills);
  const setSkills = useWorkbench((s) => s.setSkills);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    skillsList(projectPath)
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        // sidecar may not be ready yet — silent
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, setSkills]);

  function findSkill(name: string): Skill | undefined {
    return skills.find((s) => s.name === name);
  }

  async function runSkill(
    workspaceId: string,
    name: string,
    vars: Record<string, string>
  ): Promise<string> {
    const res = await skillsRun(workspaceId, name, vars);
    return res.prompt;
  }

  return { skills, findSkill, runSkill };
}
