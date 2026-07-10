import { describe, it, expect } from "vitest";
import { formatPreferences, buildLaunchPrompt, appendAttachments } from "./agent-prompt";

describe("formatPreferences", () => {
  it("returns empty string when there are no preferences", () => {
    expect(formatPreferences({})).toBe("");
  });

  it("skips blank/whitespace values", () => {
    expect(formatPreferences({ general: "  ", review: "" })).toBe("");
  });

  it("formats sorted non-blank entries into a preamble block", () => {
    expect(formatPreferences({ review: "run tests", general: "be terse" })).toBe(
      "[Project preferences]\n- general: be terse\n- review: run tests"
    );
  });

  it("trims values", () => {
    expect(formatPreferences({ general: "  be terse  " })).toBe(
      "[Project preferences]\n- general: be terse"
    );
  });
});

describe("buildLaunchPrompt", () => {
  it("returns the task prompt unchanged when there are no preferences", () => {
    expect(buildLaunchPrompt({}, "fix the bug")).toBe("fix the bug");
  });

  it("prepends the preamble with a blank-line separator when prefs exist", () => {
    expect(buildLaunchPrompt({ general: "be terse" }, "fix the bug")).toBe(
      "[Project preferences]\n- general: be terse\n\nfix the bug"
    );
  });
});

describe("appendAttachments", () => {
  it("returns the prompt unchanged when there are no attachment paths", () => {
    expect(appendAttachments("fix the bug", [])).toBe("fix the bug");
  });

  it("appends a single attachment path as a labeled block", () => {
    expect(appendAttachments("fix the bug", ["/wt/.maverick/attachments/t1/screenshot.png"])).toBe(
      "fix the bug\n\n[Attached files]\n- /wt/.maverick/attachments/t1/screenshot.png"
    );
  });

  it("appends multiple attachment paths, one per line", () => {
    expect(
      appendAttachments("fix the bug", [
        "/wt/.maverick/attachments/t1/a.png",
        "/wt/.maverick/attachments/t1/b.txt",
      ])
    ).toBe(
      "fix the bug\n\n[Attached files]\n- /wt/.maverick/attachments/t1/a.png\n- /wt/.maverick/attachments/t1/b.txt"
    );
  });
});
