import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { FileChangeChip } from "./FileChangeChip";
import type { AgentFileChange } from "@/lib/ipc";

const change: AgentFileChange = { path: "/w/src/lib/a.ts", additions: 3, deletions: 2, kind: "edit" };

describe("FileChangeChip", () => {
  it("shows the basename, tokenized +N/-N counts, and the full path as title", () => {
    render(<FileChangeChip change={change} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("+3")).toHaveClass("text-success");
    expect(screen.getByText("-2")).toHaveClass("text-destructive");
    expect(screen.getByRole("button")).toHaveAttribute("title", "/w/src/lib/a.ts");
  });

  it("fires onOpen with the full path on click", async () => {
    const onOpen = vi.fn();
    render(<FileChangeChip change={change} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("/w/src/lib/a.ts");
  });

  it("omits zero counts and tolerates a missing onOpen", async () => {
    render(<FileChangeChip change={{ ...change, additions: 0, deletions: 0 }} />);
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
    expect(screen.queryByText("-0")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
  });
});
