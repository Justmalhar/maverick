import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/utils";
import type { FileTab } from "@/state/store";
import FileTabPane from "./FileTabPane";

const stubTab: FileTab = {
  id: "file:/wt/a.ts",
  kind: "file",
  path: "/wt/a.ts",
  worktreePath: "/wt",
  preview: false,
  dirty: false,
  mode: "edit",
  viewed: false,
};

describe("FileTabPane", () => {
  it("renders the file path when active", () => {
    renderWithProviders(<FileTabPane tab={stubTab} active />);
    expect(screen.getByText("/wt/a.ts")).toBeInTheDocument();
  });
});
