import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RewindMenu } from "./RewindMenu";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({ agentRewind: vi.fn().mockResolvedValue({ ok: true }) }));

describe("RewindMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms before rewinding and reports completion", async () => {
    const onRewound = vi.fn();
    render(<RewindMenu sessionId="s1" messageId="m1" messageText="original prompt" onRewound={onRewound} />);
    await userEvent.click(screen.getByRole("button", { name: "Message actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /rewind to here/i }));
    // dialog explains the blast radius
    expect(await screen.findByText(/restores the worktree/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rewind" }));
    expect(tauri.agentRewind).toHaveBeenCalledWith("s1", "m1");
    await vi.waitFor(() => expect(onRewound).toHaveBeenCalledWith("original prompt"));
  });

  it("cancel closes without calling rewind", async () => {
    render(<RewindMenu sessionId="s1" messageId="m1" messageText="t" onRewound={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Message actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /rewind to here/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(tauri.agentRewind).not.toHaveBeenCalled();
  });

  it("keeps busy state resettable when rewind rejects, so the dialog stays usable", async () => {
    const rejectingRewind = vi.mocked(tauri.agentRewind).mockRejectedValueOnce(new Error("restore failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRewound = vi.fn();
    render(<RewindMenu sessionId="s1" messageId="m1" messageText="t" onRewound={onRewound} />);
    await userEvent.click(screen.getByRole("button", { name: "Message actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /rewind to here/i }));
    await userEvent.click(screen.getByRole("button", { name: "Rewind" }));
    await vi.waitFor(() => expect(rejectingRewind).toHaveBeenCalled());
    expect(onRewound).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("[agent] rewind failed", expect.any(Error));
    // busy reset — Cancel is usable again and dialog can still be dismissed
    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    expect(cancelButton).not.toBeDisabled();
    await userEvent.click(cancelButton);
    expect(screen.queryByText(/restores the worktree/i)).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});
