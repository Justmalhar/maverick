import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  buildCreatePrPrompt,
  buildFixErrorsPrompt,
  buildResolveConflictPrompt,
  canDispatchAgentAction,
  sendAgentPrompt,
} from "./ai-actions";
import { __testing__ } from "@/components/editor/terminal/leaf-registry";
import { makeDiff, makeDiffFile } from "@/test/fixtures";

describe("buildCreatePrPrompt", () => {
  const diff = makeDiff({ files: [makeDiffFile({ path: "a.ts", status: "M", additions: 3, deletions: 1 })] });

  it("uses the createPr preference when set", () => {
    const out = buildCreatePrPrompt(diff, "Always target develop and use Conventional Commit titles");
    expect(out).toContain("target develop");
    expect(out).toContain("- M a.ts (+3 −1)");
  });

  it("falls back to a default instruction when the preference is blank", () => {
    expect(buildCreatePrPrompt(diff, "  ")).toContain("Open a pull request");
  });

  it("omits the file list when the diff is empty", () => {
    expect(buildCreatePrPrompt(makeDiff({ files: [] }))).not.toContain("Changed files");
  });

  test("buildCreatePrPrompt instructs pushing to remote and opening against base", () => {
    const prompt = buildCreatePrPrompt({ files: [] }, undefined, undefined, { remote: "origin", base: "main" });
    expect(prompt).toContain("origin");
    expect(prompt).toContain("main");
  });

  test("buildCreatePrPrompt appends the general project preference", () => {
    const prompt = buildCreatePrPrompt({ files: [] }, "Use ticket id in title", "Never force-push");
    expect(prompt).toContain("Use ticket id in title");
    expect(prompt).toContain("Never force-push");
  });
});

describe("buildFixErrorsPrompt", () => {
  it("uses the fixErrors preference when set", () => {
    expect(buildFixErrorsPrompt("Prefer the existing test runner; never disable tests")).toContain(
      "never disable tests"
    );
  });
  it("defaults when blank", () => {
    expect(buildFixErrorsPrompt()).toContain("Run the project's build and tests");
  });
});

describe("buildResolveConflictPrompt", () => {
  it("lists conflicted files and uses the preference", () => {
    const out = buildResolveConflictPrompt(["src/a.ts", "src/b.ts"], "Prefer ours for lockfiles");
    expect(out).toContain("Prefer ours for lockfiles");
    expect(out).toContain("- src/a.ts");
    expect(out).toContain("- src/b.ts");
  });
  it("defaults and omits the list when no files", () => {
    const out = buildResolveConflictPrompt([]);
    expect(out).toContain("Resolve the merge conflicts");
    expect(out).not.toContain("Conflicted files");
  });
});

describe("sendAgentPrompt", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
    __testing__.leafPtyCache.clear();
  });

  it("writes the prompt to the live agent PTY when one exists and focuses it", async () => {
    __testing__.leafPtyCache.set("ws1-1", "pty-1"); // primaryAgentPtyId(ws1)
    const onAgentFocus = vi.fn();
    const r = await sendAgentPrompt({
      target: { workspaceId: "ws1", backend: "claude-code", cwd: "/wt" },
      prompt: "do it",
      onAgentFocus,
    });
    expect(r).toEqual({ ran: true });
    expect(onAgentFocus).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "do it\n" });
  });

  it("no-ops on an empty prompt or when there is no live agent PTY", async () => {
    expect(
      await sendAgentPrompt({ target: { workspaceId: "ws3", backend: "claude-code", cwd: "/w" }, prompt: "  " })
    ).toEqual({ ran: false });
    expect(
      await sendAgentPrompt({ target: { workspaceId: "ws4", backend: "aider", cwd: "/w" }, prompt: "x" })
    ).toEqual({ ran: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("canDispatchAgentAction", () => {
  beforeEach(() => __testing__.leafPtyCache.clear());

  it("is true only with a live PTY, false otherwise", () => {
    __testing__.leafPtyCache.set("p-1", "pty");
    expect(canDispatchAgentAction({ workspaceId: "p", backend: "aider", cwd: "/w" })).toBe(true); // PTY
    expect(canDispatchAgentAction({ workspaceId: "n", backend: "claude-code", cwd: "/w" })).toBe(false);
  });
});
