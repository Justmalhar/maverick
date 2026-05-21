// Tabbed per-repo config. Repo selector left, RepoConfig form right.
import { useState } from "react";
import { useWorkbench } from "@/state/store";
import { cn } from "@/lib/utils";
import RepoConfig from "../RepoConfig";

export default function RepositorySettings() {
  const projects = useWorkbench((s) => s.projects);
  const [selectedId, setSelectedId] = useState<string>(projects[0]?.id ?? "");

  const selected = projects.find((p) => p.id === selectedId);

  return (
    <section data-testid="repository-settings" className="grid h-full grid-cols-[200px_1fr] gap-2">
      <aside className="space-y-1 overflow-auto rounded-sm border border-border bg-card/30 p-1">
        {projects.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
            No projects yet
          </div>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              data-testid={`repo-${p.id}`}
              className={cn(
                "block w-full truncate rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
                selectedId === p.id
                  ? "bg-accent/30 text-foreground"
                  : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
              )}
            >
              <div className="truncate text-foreground">{p.name}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {p.path}
              </div>
            </button>
          ))
        )}
      </aside>
      <div className="overflow-auto">
        {selected ? (
          <RepoConfig project={selected} />
        ) : (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Select a repository on the left.
          </div>
        )}
      </div>
    </section>
  );
}
