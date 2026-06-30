import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangesSection } from "./ChangesSection";
import type { DiffFile } from "@/lib/ipc";

const files: DiffFile[] = [
  { path: "src/a.ts", status: "M", additions: 2, deletions: 1, hunks: [] },
];

describe("ChangesSection", () => {
  test("renders files and toggles selection + open diff", () => {
    const onToggle = vi.fn();
    const onOpenDiff = vi.fn();
    render(<ChangesSection files={files} selected={new Set(["src/a.ts"])} onToggle={onToggle} onOpenDiff={onOpenDiff} />);
    expect(screen.getByTestId("scm-changes-header")).toHaveTextContent("Changes (1)");
    fireEvent.click(screen.getByTestId("scm-file-src/a.ts"));
    expect(onToggle).toHaveBeenCalledWith("src/a.ts");
    fireEvent.click(screen.getByTestId("scm-open-diff-src/a.ts"));
    expect(onOpenDiff).toHaveBeenCalledWith("src/a.ts");
  });

  test("collapses when the header is clicked", () => {
    render(<ChangesSection files={files} selected={new Set()} onToggle={() => {}} onOpenDiff={() => {}} />);
    fireEvent.click(screen.getByTestId("scm-changes-header"));
    expect(screen.queryByTestId("scm-files")).not.toBeInTheDocument();
  });
});
