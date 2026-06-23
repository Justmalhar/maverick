import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { buildReviewPrompt, buildReviewCommentsPrompt, runAiReview, sendReviewComments } from "./ai-review";
import { makeDiff, makeDiffFile } from "@/test/fixtures";
import type { ReviewComment } from "@/lib/stores/review-comments";

function comment(over: Partial<ReviewComment> = {}): ReviewComment {
  return { id: "c1", workspaceId: "w1", file: "src/a.ts", line: 1, side: "new", body: "fix", ...over };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
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

describe("buildReviewCommentsPrompt", () => {
  it("returns an empty string for no comments", () => {
    expect(buildReviewCommentsPrompt([])).toBe("");
  });

  it("emits one Re: file:line — body line per comment, in order", () => {
    const prompt = buildReviewCommentsPrompt([
      comment({ file: "src/a.ts", line: 12, body: "rename this" }),
      comment({ file: "src/b.ts", line: 3, body: "handle null" }),
    ]);
    expect(prompt).toContain("Re: src/a.ts:12 — rename this");
    expect(prompt).toContain("Re: src/b.ts:3 — handle null");
    expect(prompt.indexOf("src/a.ts")).toBeLessThan(prompt.indexOf("src/b.ts"));
  });

  it("includes an instructional header", () => {
    const prompt = buildReviewCommentsPrompt([comment()]);
    expect(prompt).toContain("review comments");
  });
});

describe("sendReviewComments", () => {
  it("returns ran:false with no comments", async () => {
    const r = await sendReviewComments({ agentPtyId: "pty-1", comments: [] });
    expect(r.ran).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("returns ran:false when no agent PTY is available", async () => {
    const r = await sendReviewComments({ agentPtyId: undefined, comments: [comment()] });
    expect(r.ran).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("writes the batched prompt to the agent PTY and focuses it", async () => {
    const onAgentFocus = vi.fn();
    const r = await sendReviewComments({
      agentPtyId: "pty-1",
      comments: [comment({ file: "src/a.ts", line: 9, body: "tidy" })],
      onAgentFocus,
    });
    expect(r.ran).toBe(true);
    expect(onAgentFocus).toHaveBeenCalledTimes(1);
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "pty_write");
    expect((call?.[1] as { ptyId: string }).ptyId).toBe("pty-1");
    expect((call?.[1] as { data: string }).data).toContain("Re: src/a.ts:9 — tidy");
  });
});

describe("runAiReview", () => {
  it("returns ran:false and writes nothing when the tree is clean", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ files: [] } as never); // diff_get
    const onAgentFocus = vi.fn();
    const result = await runAiReview({
      agentPtyId: "pty-w1-1",
      worktreePath: "/wt",
      onAgentFocus,
    });
    expect(result.ran).toBe(false);
    expect(onAgentFocus).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("returns ran:false when no agent PTY is available", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      makeDiff({ files: [makeDiffFile({ path: "x.ts" })] }) as never
    ); // diff_get
    const onAgentFocus = vi.fn();
    const result = await runAiReview({
      agentPtyId: undefined,
      worktreePath: "/wt",
      onAgentFocus,
    });
    expect(result.ran).toBe(false);
    expect(onAgentFocus).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("focuses the agent and writes the review prompt to the resolved PTY", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      makeDiff({ files: [makeDiffFile({ path: "x.ts" })] }) as never
    ); // diff_get
    const onAgentFocus = vi.fn();
    const result = await runAiReview({
      agentPtyId: "pty-w1-1",
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
