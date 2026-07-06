import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import SquadDialog from "./SquadDialog";
import { makeWorkspace } from "@/test/fixtures";

const WORKSPACES = [
  makeWorkspace({ id: "ws-1", title: "backend", branch: "feat/backend" }),
  makeWorkspace({ id: "ws-2", title: "frontend", branch: "feat/frontend" }),
];

describe("SquadDialog", () => {
  it("creates a new squad with selected members", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <SquadDialog
        open
        squad={{ projectId: "p1" }}
        projectWorkspaces={WORKSPACES}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );
    await userEvent.type(screen.getByTestId("squad-name"), "Auth refactor");
    await userEvent.click(screen.getByTestId("squad-member-ws-1"));
    await userEvent.click(screen.getByTestId("squad-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", name: "Auth refactor", memberWorkspaceIds: ["ws-1"] })
    );
  });

  it("selecting a leader auto-includes it as a member", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <SquadDialog
        open
        squad={{ projectId: "p1" }}
        projectWorkspaces={WORKSPACES}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );
    await userEvent.type(screen.getByTestId("squad-name"), "x");
    await userEvent.click(screen.getByTestId("squad-leader"));
    // "backend" also appears as a member-checkbox label, so scope to the
    // dropdown's option role rather than a plain text match.
    await userEvent.click(await screen.findByRole("option", { name: "backend" }));
    await userEvent.click(screen.getByTestId("squad-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ leaderWorkspaceId: "ws-1", memberWorkspaceIds: ["ws-1"] })
    );
  });

  it("loads existing squad fields for editing", () => {
    renderWithProviders(
      <SquadDialog
        open
        squad={{ id: "s1", name: "existing", leaderWorkspaceId: "ws-1", memberWorkspaceIds: ["ws-1", "ws-2"] }}
        projectWorkspaces={WORKSPACES}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId("squad-name")).toHaveValue("existing");
    expect(screen.getByTestId("squad-member-ws-2")).toBeChecked();
  });

  it("does not submit when name is empty", () => {
    renderWithProviders(
      <SquadDialog open squad={{ projectId: "p1" }} projectWorkspaces={WORKSPACES} onOpenChange={() => {}} onSubmit={() => {}} />
    );
    expect(screen.getByTestId("squad-submit")).toBeDisabled();
  });

  it("shows a message when the project has no workspaces yet", () => {
    renderWithProviders(
      <SquadDialog open squad={{ projectId: "p1" }} projectWorkspaces={[]} onOpenChange={() => {}} onSubmit={() => {}} />
    );
    expect(screen.getByText(/No workspaces in this project yet/)).toBeInTheDocument();
  });

  it("deletes only after the user confirms", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <SquadDialog
        open
        squad={{ id: "s1", name: "existing" }}
        projectWorkspaces={WORKSPACES}
        onOpenChange={() => {}}
        onSubmit={() => {}}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByTestId("squad-delete"));
    expect(onDelete).toHaveBeenCalledWith("s1");
    confirmSpy.mockRestore();
  });

  it("does NOT delete when the confirm is dismissed", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(
      <SquadDialog
        open
        squad={{ id: "s1", name: "existing" }}
        projectWorkspaces={WORKSPACES}
        onOpenChange={() => {}}
        onSubmit={() => {}}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByTestId("squad-delete"));
    expect(onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("hides the Delete button when creating a new squad", () => {
    renderWithProviders(
      <SquadDialog open squad={{ projectId: "p1" }} projectWorkspaces={WORKSPACES} onOpenChange={() => {}} onSubmit={() => {}} onDelete={() => {}} />
    );
    expect(screen.queryByTestId("squad-delete")).not.toBeInTheDocument();
  });

  it("unchecking a member removes it", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <SquadDialog
        open
        squad={{ id: "s1", name: "x", memberWorkspaceIds: ["ws-1", "ws-2"] }}
        projectWorkspaces={WORKSPACES}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );
    await userEvent.click(screen.getByTestId("squad-member-ws-2"));
    await userEvent.click(screen.getByTestId("squad-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ memberWorkspaceIds: ["ws-1"] }));
  });
});
