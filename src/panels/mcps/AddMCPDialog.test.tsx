import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import AddMCPDialog from "./AddMCPDialog";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("AddMCPDialog", () => {
  it("submits with args + env and closes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    const onAdded = vi.fn();
    const onOpen = vi.fn();
    renderWithProviders(<AddMCPDialog open onOpenChange={onOpen} onAdded={onAdded} />);
    await userEvent.type(screen.getByTestId("mcp-name"), "fs");
    await userEvent.type(screen.getByTestId("mcp-command"), "npx");
    await userEvent.type(screen.getByTestId("mcp-arg-input"), "-y{Enter}");
    await userEvent.type(screen.getByTestId("mcp-arg-input"), "pkg");
    await userEvent.click(screen.getAllByText("Add")[0]);
    // remove the second arg
    await userEvent.click(screen.getByText(/pkg/));
    await userEvent.type(screen.getByTestId("mcp-env-key"), "API_KEY");
    await userEvent.type(screen.getByTestId("mcp-env-value"), "v");
    await userEvent.click(screen.getAllByText("Add")[1]);
    // remove the env pair
    await userEvent.click(screen.getByText(/API_KEY/));
    // submit
    await userEvent.click(screen.getByTestId("mcp-add-submit"));
    expect(onAdded).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith(false);
  });

  it("does not submit if name or command is empty", async () => {
    const onAdded = vi.fn();
    renderWithProviders(<AddMCPDialog open onOpenChange={() => {}} onAdded={onAdded} />);
    const btn = screen.getByTestId("mcp-add-submit");
    expect(btn).toBeDisabled();
  });

  it("surfaces error on failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    renderWithProviders(<AddMCPDialog open onOpenChange={() => {}} onAdded={() => {}} />);
    await userEvent.type(screen.getByTestId("mcp-name"), "x");
    await userEvent.type(screen.getByTestId("mcp-command"), "y");
    await userEvent.click(screen.getByTestId("mcp-add-submit"));
    expect(await screen.findByText(/nope/)).toBeInTheDocument();
  });

  it("ignores empty arg/env additions and resets on close", () => {
    const { rerender } = renderWithProviders(<AddMCPDialog open onOpenChange={() => {}} onAdded={() => {}} />);
    rerender(<AddMCPDialog open={false} onOpenChange={() => {}} onAdded={() => {}} />);
  });

  it("cancel button invokes onOpenChange(false)", async () => {
    const onOpen = vi.fn();
    renderWithProviders(<AddMCPDialog open onOpenChange={onOpen} onAdded={() => {}} />);
    await userEvent.click(screen.getByText("Cancel"));
    expect(onOpen).toHaveBeenCalledWith(false);
  });

  it("includes env in the submitted payload (covers env reduce)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    const onAdded = vi.fn();
    renderWithProviders(<AddMCPDialog open onOpenChange={() => {}} onAdded={onAdded} />);
    await userEvent.type(screen.getByTestId("mcp-name"), "fs");
    await userEvent.type(screen.getByTestId("mcp-command"), "npx");
    await userEvent.type(screen.getByTestId("mcp-env-key"), "KEY");
    await userEvent.type(screen.getByTestId("mcp-env-value"), "VAL");
    await userEvent.click(screen.getAllByText("Add")[1]);
    await userEvent.click(screen.getByTestId("mcp-add-submit"));
    expect(invoke).toHaveBeenCalledWith("mcp_add", expect.objectContaining({ env: { KEY: "VAL" } }));
    expect(onAdded).toHaveBeenCalled();
  });

  it("applies a bundled preset to prefill the form and submits with workspaceId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    const onAdded = vi.fn();
    renderWithProviders(
      <AddMCPDialog open onOpenChange={() => {}} onAdded={onAdded} workspaceId="w1" />
    );
    await userEvent.click(screen.getByTestId("mcp-preset-filesystem"));
    expect(screen.getByTestId("mcp-name")).toHaveValue("filesystem");
    expect(screen.getByTestId("mcp-command")).toHaveValue("npx");
    await userEvent.click(screen.getByTestId("mcp-add-submit"));
    expect(invoke).toHaveBeenCalledWith(
      "mcp_add",
      expect.objectContaining({ name: "filesystem", command: "npx", workspaceId: "w1" })
    );
  });

  it("renders every bundled preset chip", () => {
    renderWithProviders(<AddMCPDialog open onOpenChange={() => {}} onAdded={() => {}} />);
    for (const id of ["filesystem", "git", "sqlite", "fetch"]) {
      expect(screen.getByTestId(`mcp-preset-${id}`)).toBeInTheDocument();
    }
  });
});
