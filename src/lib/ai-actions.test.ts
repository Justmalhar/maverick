import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  buildCreatePrPrompt,
  buildFixErrorsPrompt,
  buildResolveConflictPrompt,
  sendAgentPrompt,
} from "./ai-actions";
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
  });

  it("writes the prompt (with newline) to the agent PTY and focuses it", async () => {
    const onAgentFocus = vi.fn();
    const r = await sendAgentPrompt({ agentPtyId: "pty-1", prompt: "do it", onAgentFocus });
    expect(r).toEqual({ ran: true });
    expect(onAgentFocus).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "do it\n" });
  });

  it("no-ops without an agent PTY or with an empty prompt", async () => {
    expect(await sendAgentPrompt({ agentPtyId: undefined, prompt: "x" })).toEqual({ ran: false });
    expect(await sendAgentPrompt({ agentPtyId: "pty-1", prompt: "  " })).toEqual({ ran: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});
