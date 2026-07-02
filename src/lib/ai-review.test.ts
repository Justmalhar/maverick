import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { buildReviewPrompt, runAiReview } from "./ai-review";
import { __testing__ } from "@/components/editor/terminal/leaf-registry";
import { makeDiff, makeDiffFile } from "@/test/fixtures";

// A workspace with a live agent PTY is reachable; one with no PTY is not.
const PTY_TARGET = { workspaceId: "w1", backend: "claude-code", cwd: "/wt" };
const UNREACHABLE_TARGET = { workspaceId: "wX", backend: "aider", cwd: "/wt" };

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  __testing__.leafPtyCache.clear();
});

describe("buildReviewPrompt", () => {
  it("uses the default instruction when no preference is provided", () => {
    const prompt = buildReviewPrompt(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }));
    expect(prompt).toContain("Review the staged and unstaged changes");
    expect(prompt).toContain("- M a.ts (+1 −0)");
  });

  it("uses a custom review preference when provided", () => {
    const prompt = buildReviewPrompt(
      makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }),
      "Focus on security only."
    );
    expect(prompt).toContain("Focus on security only.");
    expect(prompt).not.toContain("Review the staged and unstaged changes");
  });

  it("falls back to the default instruction for a whitespace-only preference", () => {
    const prompt = buildReviewPrompt(makeDiff(), "   ");
    expect(prompt).toContain("Review the staged and unstaged changes");
  });
});

describe("runAiReview", () => {
  it("returns ran:false and writes nothing when the tree is clean", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ files: [] } as never); // diff_get
    const onAgentFocus = vi.fn();
    const result = await runAiReview({ target: PTY_TARGET, worktreePath: "/wt", onAgentFocus });
    expect(result.ran).toBe(false);
    expect(onAgentFocus).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("returns ran:false when the agent is unreachable", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      makeDiff({ files: [makeDiffFile({ path: "x.ts" })] }) as never
    ); // diff_get
    const onAgentFocus = vi.fn();
    const result = await runAiReview({ target: UNREACHABLE_TARGET, worktreePath: "/wt", onAgentFocus });
    expect(result.ran).toBe(false);
    expect(onAgentFocus).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("focuses the agent and writes the review prompt to the resolved PTY", async () => {
    __testing__.leafPtyCache.set("w1-1", "pty-w1-1");
    vi.mocked(invoke).mockResolvedValueOnce(
      makeDiff({ files: [makeDiffFile({ path: "x.ts" })] }) as never
    ); // diff_get
    const onAgentFocus = vi.fn();
    const result = await runAiReview({
      target: PTY_TARGET,
      worktreePath: "/wt",
      reviewPref: "Be terse.",
      onAgentFocus,
    });
    expect(result.ran).toBe(true);
    expect(onAgentFocus).toHaveBeenCalledTimes(1);
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "pty_write");
    expect(call).toBeDefined();
    expect((call?.[1] as { ptyId: string; data: string }).ptyId).toBe("pty-w1-1");
    expect((call?.[1] as { data: string }).data).toContain("Be terse.");
    expect((call?.[1] as { data: string }).data).toContain("- M x.ts");
  });
});
