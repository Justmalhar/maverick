import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { CreateFromDialog } from "./CreateFromDialog";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("CreateFromDialog", () => {
  it("lists local and remote branches and fires onSelect", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { name: "main", isRemote: false, isCurrent: true },
      { name: "origin/develop", isRemote: true, isCurrent: false },
    ] as never);
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <CreateFromDialog open onOpenChange={onOpenChange} projectPath="/p" onSelect={onSelect} />
    );
    expect(await screen.findByTestId("create-from-branch-main")).toHaveTextContent("current");
    await userEvent.click(screen.getByTestId("create-from-branch-origin/develop"));
    expect(onSelect).toHaveBeenCalledWith("origin/develop");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters branches by the search query", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { name: "main", isRemote: false, isCurrent: true },
      { name: "origin/develop", isRemote: true, isCurrent: false },
    ] as never);
    renderWithProviders(
      <CreateFromDialog open onOpenChange={() => {}} projectPath="/p" onSelect={() => {}} />
    );
    await screen.findByTestId("create-from-branch-main");
    await userEvent.type(screen.getByTestId("create-from-input"), "devel");
    await waitFor(() =>
      expect(screen.queryByTestId("create-from-branch-main")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("create-from-branch-origin/develop")).toBeInTheDocument();
  });

  it("shows the empty hint when branch listing fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("not a repo"));
    renderWithProviders(
      <CreateFromDialog open onOpenChange={() => {}} projectPath="/p" onSelect={() => {}} />
    );
    expect(await screen.findByText("No branches found")).toBeInTheDocument();
  });

  it("does not query branches while closed or without a project path", () => {
    renderWithProviders(
      <CreateFromDialog open={false} onOpenChange={() => {}} projectPath="/p" onSelect={() => {}} />
    );
    renderWithProviders(
      <CreateFromDialog open onOpenChange={() => {}} projectPath={null} onSelect={() => {}} />
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
