import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor, act } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { dispatchOsNotification } from "@/lib/os-notify";
import type { Notification } from "@/lib/ipc";

vi.mock("@/lib/os-notify", () => ({
  dispatchOsNotification: vi.fn().mockResolvedValue(true),
}));

// useWindowFocus calls getCurrentWindow().onFocusChanged; mock it so the hook
// doesn't touch Tauri internals. Focus state then seeds from document.hasFocus().
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));

import { Toaster } from "./Toaster";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    workspaceId: null,
    type: "info",
    title: "Build complete",
    body: "All checks passed",
    read: false,
    createdAt: 0,
    ...overrides,
  };
}

let sendHandlers: Array<(n: Notification) => void>;
const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(dispatchOsNotification).mockClear();
  sendHandlers = [];
  vi.mocked(listen).mockReset().mockImplementation((async (event: string, cb: (e: { payload: Notification }) => void) => {
    if (event === "notification:send") {
      sendHandlers.push((p: Notification) => cb({ payload: p }));
    }
    return () => {};
  }) as unknown as typeof listen);
  useWorkbench.setState({ ...initial, activeWorkspaceId: null });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

describe("Toaster", () => {
  it("fires an OS notification (no toast) when the window is unfocused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    renderWithProviders(<Toaster />);
    await waitFor(() => expect(sendHandlers.length).toBeGreaterThan(0));

    act(() => sendHandlers[0](makeNotification({ id: "n1", title: "Done", body: "ok" })));

    expect(dispatchOsNotification).toHaveBeenCalledWith("Done", "ok");
    expect(screen.queryByTestId("toast-n1")).not.toBeInTheDocument();
  });

  it("shows a toast (no OS notification) when focused on a different workspace", async () => {
    useWorkbench.setState({ ...initial, activeWorkspaceId: "ws-active" });
    renderWithProviders(<Toaster />);
    await waitFor(() => expect(sendHandlers.length).toBeGreaterThan(0));

    act(() => sendHandlers[0](makeNotification({ id: "n1", workspaceId: "ws-other", title: "Done", body: "ok" })));

    expect(await screen.findByTestId("toast-n1")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(dispatchOsNotification).not.toHaveBeenCalled();
  });

  it("suppresses (no toast, no OS notification) when focused on the relevant workspace", async () => {
    useWorkbench.setState({ ...initial, activeWorkspaceId: "ws-1" });
    renderWithProviders(<Toaster />);
    await waitFor(() => expect(sendHandlers.length).toBeGreaterThan(0));

    act(() => sendHandlers[0](makeNotification({ id: "n1", workspaceId: "ws-1" })));

    expect(screen.queryByTestId("toast-n1")).not.toBeInTheDocument();
    expect(dispatchOsNotification).not.toHaveBeenCalled();
  });

  it("dismisses a toast when its close button is clicked", async () => {
    renderWithProviders(<Toaster />);
    await waitFor(() => expect(sendHandlers.length).toBeGreaterThan(0));
    act(() => sendHandlers[0](makeNotification({ id: "n2", title: "Closable" })));
    expect(await screen.findByTestId("toast-n2")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(screen.queryByTestId("toast-n2")).not.toBeInTheDocument());
  });

  it("keeps only the most recent toasts (caps the queue)", async () => {
    renderWithProviders(<Toaster />);
    await waitFor(() => expect(sendHandlers.length).toBeGreaterThan(0));
    act(() => {
      for (let i = 0; i < 6; i++) {
        sendHandlers[0](makeNotification({ id: `n-${i}`, title: `T${i}` }));
      }
    });
    // MAX_VISIBLE = 4 → the two oldest are dropped.
    expect(screen.queryByTestId("toast-n-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toast-n-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("toast-n-5")).toBeInTheDocument();
  });
});
