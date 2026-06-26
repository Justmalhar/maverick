import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectItem } from "./ProjectItem";
import { CreateFromDialog } from "./CreateFromDialog";
import { NameWorkspaceDialog } from "./NameWorkspaceDialog";
import { pickProjectFolder } from "@/lib/dialog";
import { resolveStartupLaunch } from "@/lib/launch";

const DEFAULT_BACKEND = "claude-code";

export function ProjectsView() {
  const projects = useWorkbench((s) => s.projects);
  const openProjectSettings = useWorkbench((s) => s.openProjectSettings);
  const { addProjectFromPath, create } = useWorkspace();
  const [createFromProjectId, setCreateFromProjectId] = useState<string | null>(null);
  const [nameWorkspaceProjectId, setNameWorkspaceProjectId] = useState<string | null>(null);

  async function onAddProject() {
    const path = await pickProjectFolder();
    if (!path) return;
    try {
      await addProjectFromPath(path);
    } catch (e) {
      console.error("addProject failed", e);
    }
  }

  // Creates the workspace and stages a launch spec so the default agent CLI
  // (e.g. `claude`) auto-starts. `branch` undefined → the sidecar generates a
  // temporary callsign (the "let AI name it later" path); a provided branch
  // (e.g. "feature/login-page") is used verbatim.
  async function onAddWorkspace(
    projectId: string,
    opts: { baseBranch?: string; branch?: string; aiLater?: boolean } = {}
  ) {
    try {
      const ws = await create(projectId, opts.branch, DEFAULT_BACKEND, opts.baseBranch);
      const { command, args } = resolveStartupLaunch(DEFAULT_BACKEND);
      useWorkbench.getState().setLaunchSpec(ws.id, { command, args });
      // "Let AI name it later": mark for an AI rename from the diff after first commit.
      if (opts.aiLater) useWorkbench.getState().markPendingAiRename(ws.id);
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
        <span className="min-w-0 truncate pl-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">
          Projects
        </span>
        <div className="flex shrink-0 items-center">
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
                onAddWorkspace={(projectId) => setNameWorkspaceProjectId(projectId)}
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
          if (createFromProjectId) void onAddWorkspace(createFromProjectId, { baseBranch });
        }}
      />

      <NameWorkspaceDialog
        open={nameWorkspaceProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setNameWorkspaceProjectId(null);
        }}
        onCreate={(branch) => {
          if (nameWorkspaceProjectId) void onAddWorkspace(nameWorkspaceProjectId, { branch });
        }}
        onAiLater={() => {
          if (nameWorkspaceProjectId) void onAddWorkspace(nameWorkspaceProjectId, { aiLater: true });
        }}
      />
    </div>
  );
}
