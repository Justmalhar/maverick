import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useProjectSettingsStore } from "./project-settings";

const STUB = {
  name: "demo", rootPath: "/p/demo",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin", previewUrl: "",
  scripts: { setup: "", run: "", archive: "" },
  preferences: {},
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useProjectSettingsStore.getState().reset();
});

describe("useProjectSettingsStore", () => {
  it("load fetches and sets data", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(STUB as never);
    await useProjectSettingsStore.getState().load("p1");
    expect(useProjectSettingsStore.getState().data?.name).toBe("demo");
    expect(useProjectSettingsStore.getState().status).toBe("loaded");
  });

  it("patch accumulates dirty without invoking", () => {
    useProjectSettingsStore.setState({ data: STUB, projectId: "p1", status: "loaded" });
    useProjectSettingsStore.getState().patch({ remote: "upstream" });
    expect(useProjectSettingsStore.getState().dirty.remote).toBe("upstream");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("flush writes dirty patch and clears it", async () => {
    useProjectSettingsStore.setState({ data: STUB, projectId: "p1", status: "loaded" });
    useProjectSettingsStore.getState().patch({ remote: "upstream" });
    vi.mocked(invoke).mockResolvedValueOnce({ ...STUB, remote: "upstream" } as never);
    await useProjectSettingsStore.getState().flush();
    expect(invoke).toHaveBeenCalledWith("project_settings_update", { projectId: "p1", patch: { remote: "upstream" } });
    expect(useProjectSettingsStore.getState().dirty).toEqual({});
    expect(useProjectSettingsStore.getState().status).toBe("loaded");
  });

  it("flush surfaces error and keeps dirty", async () => {
    useProjectSettingsStore.setState({ data: STUB, projectId: "p1", status: "loaded" });
    useProjectSettingsStore.getState().patch({ remote: "upstream" });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("write fail"));
    await useProjectSettingsStore.getState().flush();
    expect(useProjectSettingsStore.getState().status).toBe("error");
    expect(useProjectSettingsStore.getState().lastError).toContain("write fail");
    expect(useProjectSettingsStore.getState().dirty.remote).toBe("upstream");
  });
});
