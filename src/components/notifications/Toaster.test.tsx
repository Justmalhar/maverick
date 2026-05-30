import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor, act } from "@/test/utils";
import { Toaster } from "./Toaster";
import { dispatchOsNotification } from "@/lib/os-notify";
import type { Notification } from "@/lib/ipc";

vi.mock("@/lib/os-notify", () => ({
  dispatchOsNotification: vi.fn().mockResolvedValue(true),
}));

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

beforeEach(() => {
  vi.mocked(dispatchOsNotification).mockClear();
  sendHandlers = [];
  vi.mocked(listen).mockReset().mockImplementation((async (event: string, cb: (e: { payload: Notification }) => void) => {
    if (event === "notification:send") {
      sendHandlers.push((p: Notification) => cb({ payload: p }));
    }
    return () => {};
  }) as unknown as typeof listen);
});

describe("Toaster", () => {
  it("renders a toast and fires an OS notification on notification:send", async () => {
    renderWithProviders(<Toaster />);
    await waitFor(() => expect(sendHandlers.length).toBeGreaterThan(0));

    act(() => sendHandlers[0](makeNotification({ id: "n1", title: "Done", body: "ok" })));

    expect(await screen.findByTestId("toast-n1")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(dispatchOsNotification).toHaveBeenCalledWith("Done", "ok");
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
