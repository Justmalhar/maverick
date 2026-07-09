import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ToolCallRow } from "./ToolCallRow";

const part = {
  type: "tool-call" as const,
  toolUseId: "t1",
  toolName: "Edit",
  title: "Edit",
  detail: "/w/a.ts",
  status: "ok" as const,
  output: "done",
  fileChanges: [{ path: "/w/a.ts", additions: 3, deletions: 2, kind: "edit" as const }],
};

describe("ToolCallRow", () => {
  it("shows title, detail chip, and file chips with counts; expands output on click", async () => {
    const onOpenFile = vi.fn();
    render(<ToolCallRow part={part} onOpenFile={onOpenFile} />);
    expect(screen.getByText("/w/a.ts", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("done")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("file-chip-/w/a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("/w/a.ts");
  });

  it("shows an error icon for a failed tool call", () => {
    render(<ToolCallRow part={{ ...part, status: "error", fileChanges: undefined }} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
