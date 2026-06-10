import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectItem } from "./ProjectItem";
import { CreateFromDialog } from "./CreateFromDialog";
import { pickProjectFolder } from "@/lib/dialog";

const DEFAULT_BACKEND = "claude-code";

export function ProjectsView() {
  const projects = useWorkbench((s) => s.projects);
  const openProjectSettings = useWorkbench((s) => s.openProjectSettings);
  const { addProjectFromPath, create } = useWorkspace();
  const [createFromProjectId, setCreateFromProjectId] = useState<string | null>(null);

  async function onAddProject() {
    const path = await pickProjectFolder();
    if (!path) return;
    try {
      await addProjectFromPath(path);
    } catch (e) {
      console.error("addProject failed", e);
    }
  }

  // Branch name and base branch are resolved by the sidecar (generated
  // callsign, branched from project settings' branchFrom).
  async function onAddWorkspace(projectId: string, baseBranch?: string) {
    try {
      await create(projectId, undefined, DEFAULT_BACKEND, baseBranch);
    } catch (e) {
      console.error("addWorkspace failed", e);
    }
  }

  const createFromProject = projects.find((p) => p.id === createFromProjectId) ?? null;

  return (
    <div data-testid="projects-view" className="flex h-full flex-col">
      <header
        className="group/header flex shrink-0 items-center justify-between px-3 pt-4 pb-4"
        style={{ height: "var(--section-header-height)" }}
      >
        <span className="pl-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">
          Projects
        </span>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onAddProject}
                aria-label="Add project"
                data-testid="projects-add"
                className="flex h-5 w-5 items-center justify-center rounded-sm text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Add project</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {projects.length === 0 ? (
            <p
              data-testid="projects-empty"
              className="px-4 py-3 text-xs text-muted-foreground"
            >
              No projects yet
            </p>
          ) : (
            projects.map((p) => (
              <ProjectItem
                key={p.id}
                project={p}
                onAddWorkspace={(projectId) => void onAddWorkspace(projectId)}
                onSettings={(projectId) => openProjectSettings({ projectId })}
                onCreateFrom={(projectId) => setCreateFromProjectId(projectId)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <CreateFromDialog
        open={createFromProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setCreateFromProjectId(null);
        }}
        projectPath={createFromProject?.path ?? null}
        onSelect={(baseBranch) => {
          if (createFromProjectId) void onAddWorkspace(createFromProjectId, baseBranch);
        }}
      />
    </div>
  );
}
