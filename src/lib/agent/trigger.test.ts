import { describe, it, expect } from "vitest";
import { detectTrigger, applyTrigger } from "./trigger";

describe("detectTrigger", () => {
  it("detects / only at the start of the draft", () => {
    expect(detectTrigger("/comp", 5)).toEqual({ kind: "slash", query: "comp", start: 0 });
    expect(detectTrigger("run /comp", 9)).toBeNull();
  });
  it("detects @ after whitespace or at start, query up to the caret", () => {
    expect(detectTrigger("fix @db-re", 10)).toEqual({ kind: "mention", query: "db-re", start: 4 });
    expect(detectTrigger("@src", 4)).toEqual({ kind: "mention", query: "src", start: 0 });
    expect(detectTrigger("email me a@b", 12)).toBeNull();
  });
  it("no trigger once the token contains whitespace or the caret left the token", () => {
    expect(detectTrigger("fix @db rep", 11)).toBeNull();
    expect(detectTrigger("fix @db", 3)).toBeNull();
  });
});

describe("applyTrigger", () => {
  it("replaces the trigger token and appends a space", () => {
    expect(applyTrigger("fix @db-re please", { kind: "mention", query: "db-re", start: 4 }, "@scripts/db-repl.ts")).toEqual({
      text: "fix @scripts/db-repl.ts  please",
      caret: 24,
    });
  });
});
