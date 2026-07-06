import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import AutopilotDialog from "./AutopilotDialog";
import { makeBackend } from "@/test/fixtures";

const BACKENDS = [makeBackend({ id: "claude", name: "Claude" }), makeBackend({ id: "codex", name: "Codex", active: false })];

describe("AutopilotDialog", () => {
  it("creates a new manual-only autopilot", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <AutopilotDialog open autopilot={{ projectId: "p1" }} backends={BACKENDS} onOpenChange={() => {}} onSubmit={onSubmit} />
    );
    await userEvent.type(screen.getByTestId("autopilot-name"), "Nightly cleanup");
    await userEvent.type(screen.getByTestId("autopilot-prompt"), "Clean up stale branches");
    await userEvent.click(screen.getByTestId("autopilot-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        name: "Nightly cleanup",
        prompt: "Clean up stale branches",
        intervalMinutes: null,
        enabled: true,
      })
    );
  });

  it("enables a recurring schedule and submits the interval", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <AutopilotDialog open autopilot={{ projectId: "p1" }} backends={BACKENDS} onOpenChange={() => {}} onSubmit={onSubmit} />
    );
    await userEvent.type(screen.getByTestId("autopilot-name"), "Hourly sync");
    await userEvent.click(screen.getByTestId("autopilot-recurring"));
    const interval = screen.getByTestId("autopilot-interval") as HTMLInputElement;
    await userEvent.clear(interval);
    await userEvent.type(interval, "15");
    await userEvent.click(screen.getByTestId("autopilot-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ intervalMinutes: 15 }));
  });

  it("defaults to the active backend when creating new", () => {
    renderWithProviders(
      <AutopilotDialog open autopilot={{ projectId: "p1" }} backends={BACKENDS} onOpenChange={() => {}} onSubmit={() => {}} />
    );
    expect(screen.getByTestId("autopilot-backend")).toHaveTextContent("Claude");
  });

  it("loads existing autopilot fields for editing", () => {
    renderWithProviders(
      <AutopilotDialog
        open
        autopilot={{ id: "a1", name: "existing", backend: "codex", branch: "main", prompt: "do it", intervalMinutes: 30, enabled: false }}
        backends={BACKENDS}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId("autopilot-name")).toHaveValue("existing");
    expect(screen.getByTestId("autopilot-branch")).toHaveValue("main");
    expect(screen.getByTestId("autopilot-prompt")).toHaveValue("do it");
    expect(screen.getByTestId("autopilot-interval")).toHaveValue(30);
  });

  it("does not submit when name is empty", () => {
    renderWithProviders(
      <AutopilotDialog open autopilot={{ projectId: "p1" }} backends={BACKENDS} onOpenChange={() => {}} onSubmit={() => {}} />
    );
    expect(screen.getByTestId("autopilot-submit")).toBeDisabled();
  });

  it("deletes only after the user confirms", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <AutopilotDialog
        open
        autopilot={{ id: "a1", name: "existing" }}
        backends={BACKENDS}
        onOpenChange={() => {}}
        onSubmit={() => {}}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByTestId("autopilot-delete"));
    expect(onDelete).toHaveBeenCalledWith("a1");
    confirmSpy.mockRestore();
  });

  it("does NOT delete when the confirm is dismissed", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(
      <AutopilotDialog
        open
        autopilot={{ id: "a1", name: "existing" }}
        backends={BACKENDS}
        onOpenChange={() => {}}
        onSubmit={() => {}}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByTestId("autopilot-delete"));
    expect(onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("hides the Delete button when creating a new autopilot", () => {
    renderWithProviders(
      <AutopilotDialog open autopilot={{ projectId: "p1" }} backends={BACKENDS} onOpenChange={() => {}} onSubmit={() => {}} onDelete={() => {}} />
    );
    expect(screen.queryByTestId("autopilot-delete")).not.toBeInTheDocument();
  });

  it("falls back to 60 minutes for a non-numeric interval", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <AutopilotDialog open autopilot={{ projectId: "p1" }} backends={BACKENDS} onOpenChange={() => {}} onSubmit={onSubmit} />
    );
    await userEvent.type(screen.getByTestId("autopilot-name"), "x");
    await userEvent.click(screen.getByTestId("autopilot-recurring"));
    const interval = screen.getByTestId("autopilot-interval") as HTMLInputElement;
    await userEvent.clear(interval);
    await userEvent.click(screen.getByTestId("autopilot-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ intervalMinutes: 60 }));
  });
});
