import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectItem } from "./ProjectItem";
import { NewWorkspaceDialog, type NewWorkspacePayload } from "./NewWorkspaceDialog";
import { pickProjectFolder } from "@/lib/dialog";
import { resolveStartupLaunch } from "@/lib/launch";

export function ProjectsView() {
  const projects = useWorkbench((s) => s.projects);
  const openProjectSettings = useWorkbench((s) => s.openProjectSettings);
  const { addProjectFromPath, create } = useWorkspace();
  const [newWorkspaceProjectId, setNewWorkspaceProjectId] = useState<string | null>(null);

  async function onAddProject() {
    const path = await pickProjectFolder();
    if (!path) return;
    try {
      await addProjectFromPath(path);
    } catch (e) {
      console.error("addProject failed", e);
    }
  }

  async function onAddWorkspace(projectId: string, opts: NewWorkspacePayload) {
    try {
      const backend = opts.backend;
      const ws = await create(projectId, opts.branch, backend, opts.baseBranch);
      const { command, args } = resolveStartupLaunch(backend);
      useWorkbench.getState().setLaunchSpec(ws.id, { command, args });
      if (opts.aiLater) useWorkbench.getState().markPendingAiRename(ws.id);
    } catch (e) {
      console.error("addWorkspace failed", e);
    }
  }

  const newWorkspaceProject = projects.find((p) => p.id === newWorkspaceProjectId) ?? null;

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
                onAddWorkspace={(projectId) => setNewWorkspaceProjectId(projectId)}
                onSettings={(projectId) => openProjectSettings({ projectId })}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <NewWorkspaceDialog
        open={newWorkspaceProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setNewWorkspaceProjectId(null);
        }}
        projectName={newWorkspaceProject?.name ?? ""}
        projectPath={newWorkspaceProject?.path ?? null}
        onSubmit={(payload) => {
          if (newWorkspaceProjectId) void onAddWorkspace(newWorkspaceProjectId, payload);
        }}
      />
    </div>
  );
}
