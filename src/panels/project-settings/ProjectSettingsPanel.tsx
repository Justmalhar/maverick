import { useEffect, useMemo, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SettingsShell } from "@/components/settings-shell";
import { SettingsFooter } from "@/panels/settings/SettingsFooter";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { useWorkbench } from "@/state/store";
import {
  ProjectSettingsNavRail,
  type ProjectSection,
} from "./ProjectSettingsNavRail";
import IdentitySection from "./sections/IdentitySection";
import WorkspacesSection from "./sections/WorkspacesSection";
import PreviewSection from "./sections/PreviewSection";
import ScriptsSection from "./sections/ScriptsSection";
import PreferencesSection from "./sections/PreferencesSection";

const SECTIONS: Record<ProjectSection, ComponentType> = {
  identity: IdentitySection,
  workspaces: WorkspacesSection,
  preview: PreviewSection,
  scripts: ScriptsSection,
  preferences: PreferencesSection,
};

type FooterStatus = "idle" | "saving" | "saved" | "error";

function toFooterStatus(
  status: "idle" | "loading" | "loaded" | "saving" | "error",
): FooterStatus {
  if (status === "saving") return "saving";
  if (status === "error") return "error";
  if (status === "loaded") return "idle";
  return "idle";
}

interface Props {
  open: boolean;
  projectId: string | null;
  initialSection?: ProjectSection;
  onOpenChange: (open: boolean) => void;
}

export default function ProjectSettingsPanel({
  open,
  projectId,
  initialSection = "identity",
  onOpenChange,
}: Props) {
  const [section, setSection] = useState<ProjectSection>(initialSection);
  const project = useWorkbench(
    (s) => s.projects.find((p) => p.id === projectId) ?? null,
  );
  const load = useProjectSettingsStore((s) => s.load);
  const reset = useProjectSettingsStore((s) => s.reset);
  const status = useProjectSettingsStore((s) => s.status);
  const data = useProjectSettingsStore((s) => s.data);
  const lastError = useProjectSettingsStore((s) => s.lastError);

  useEffect(() => {
    if (open && projectId) {
      void load(projectId);
      setSection(initialSection);
    }
    if (!open) reset();
  }, [open, projectId, initialSection, load, reset]);

  const Section = useMemo(() => SECTIONS[section], [section]);
  const title = `Project Settings · ${data?.name ?? project?.name ?? "…"}`;

  return (
    <SettingsShell
      open={open}
      onOpenChange={onOpenChange}
      testId="project-settings-panel"
      title={title}
      description="Per-project identity, workspaces, preview, scripts, and preferences."
      nav={
        <ProjectSettingsNavRail section={section} onSelect={setSection} />
      }
      footer={
        <SettingsFooter
          status={toFooterStatus(status)}
          errorMessage={lastError ?? undefined}
        />
      }
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          <Section />
        </motion.div>
      </AnimatePresence>
    </SettingsShell>
  );
}
