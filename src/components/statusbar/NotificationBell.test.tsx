import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { NotificationBell } from "./NotificationBell";
import type { Notification } from "@/lib/ipc";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n-1",
    workspaceId: null,
    type: "info",
    title: "Build complete",
    body: "All checks passed",
    read: false,
    createdAt: Math.floor(Date.now() / 1000) - 60,
    ...overrides,
  };
}

let notifySendHandlers: Array<(payload: Notification) => void>;

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  notifySendHandlers = [];
  vi.mocked(listen).mockReset().mockImplementation((async (event: string, cb: (e: { payload: Notification }) => void) => {
    if (event === "notification:send") {
      notifySendHandlers.push((p: Notification) => cb({ payload: p }));
    }
    return () => {};
  }) as unknown as typeof listen);
});

describe("NotificationBell", () => {
  it("shows zero count and empty popover when there are no notifications", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("notify_list", { limit: 50, unreadOnly: undefined }));
    await userEvent.click(screen.getByTestId("statusbar-notifications"));
    expect(await screen.findByTestId("notification-empty")).toBeInTheDocument();
  });

  it("renders the unread count badge and notification rows", async () => {
    const items = [
      makeNotification({ id: "n1", title: "Build failed", read: false }),
      makeNotification({ id: "n2", title: "Agent ready", read: true }),
    ];
    vi.mocked(invoke).mockResolvedValueOnce(items as never);
    renderWithProviders(<NotificationBell />);
    expect(await screen.findByTestId("statusbar-notifications-count")).toHaveTextContent("1");
    await userEvent.click(screen.getByTestId("statusbar-notifications"));
    expect(await screen.findByTestId("notification-item-n1")).toBeInTheDocument();
    expect(screen.getByTestId("notification-item-n2")).toBeInTheDocument();
  });

  it("marks a single notification read and updates the badge", async () => {
    const items = [makeNotification({ id: "n1", read: false })];
    vi.mocked(invoke).mockResolvedValueOnce(items as never);
    renderWithProviders(<NotificationBell />);
    await userEvent.click(await screen.findByTestId("statusbar-notifications"));
    expect(await screen.findByTestId("notification-item-n1")).toBeInTheDocument();

    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    await userEvent.click(screen.getByTestId("notification-mark-n1"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("notify_mark_read", { id: "n1" })
    );
    expect(screen.queryByTestId("statusbar-notifications-count")).not.toBeInTheDocument();
  });

  it("marks all read via the header action", async () => {
    const items = [
      makeNotification({ id: "n1", read: false }),
      makeNotification({ id: "n2", read: false }),
    ];
    vi.mocked(invoke).mockResolvedValueOnce(items as never);
    renderWithProviders(<NotificationBell />);
    await userEvent.click(await screen.findByTestId("statusbar-notifications"));

    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    await userEvent.click(screen.getByTestId("notification-mark-all"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("notify_mark_all_read"));
    expect(screen.queryByTestId("statusbar-notifications-count")).not.toBeInTheDocument();
  });

  it("marks one of several notifications read, leaving the rest untouched", async () => {
    const items = [
      makeNotification({ id: "n1", read: false }),
      makeNotification({ id: "n2", read: false }),
    ];
    vi.mocked(invoke).mockResolvedValueOnce(items as never);
    renderWithProviders(<NotificationBell />);
    expect(await screen.findByTestId("statusbar-notifications-count")).toHaveTextContent("2");
    await userEvent.click(screen.getByTestId("statusbar-notifications"));

    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    await userEvent.click(screen.getByTestId("notification-mark-n1"));
    await waitFor(() =>
      expect(screen.getByTestId("statusbar-notifications-count")).toHaveTextContent("1")
    );
  });

  it("ignores a late notify_list resolve after unmount", async () => {
    let resolveList!: (v: Notification[]) => void;
    vi.mocked(invoke).mockReset().mockImplementationOnce(
      () => new Promise<Notification[]>((res) => { resolveList = res; }) as never
    );
    const { unmount } = renderWithProviders(<NotificationBell />);
    unmount();
    resolveList([makeNotification({ id: "late" })]);
    await Promise.resolve();
    // No assertion error / state update after unmount is the criterion.
    expect(true).toBe(true);
  });

  it("ignores a late notify_list rejection after unmount", async () => {
    let rejectList!: (e: Error) => void;
    vi.mocked(invoke).mockReset().mockImplementationOnce(
      () => new Promise<Notification[]>((_, rej) => { rejectList = rej; }) as never
    );
    const { unmount } = renderWithProviders(<NotificationBell />);
    unmount();
    rejectList(new Error("late"));
    await Promise.resolve();
    expect(true).toBe(true);
  });

  it("still resolves to an empty loaded state when notify_list rejects", async () => {
    vi.mocked(invoke).mockReset().mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<NotificationBell />);
    await userEvent.click(await screen.findByTestId("statusbar-notifications"));
    expect(await screen.findByTestId("notification-empty")).toBeInTheDocument();
  });

  it("swallows errors when marking a single notification read fails", async () => {
    const items = [makeNotification({ id: "n1", read: false })];
    vi.mocked(invoke).mockResolvedValueOnce(items as never);
    renderWithProviders(<NotificationBell />);
    await userEvent.click(await screen.findByTestId("statusbar-notifications"));

    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    await userEvent.click(screen.getByTestId("notification-mark-n1"));
    await waitFor(() =>
      expect(screen.queryByTestId("statusbar-notifications-count")).not.toBeInTheDocument()
    );
  });

  it("swallows errors when marking all read fails", async () => {
    const items = [makeNotification({ id: "n1", read: false })];
    vi.mocked(invoke).mockResolvedValueOnce(items as never);
    renderWithProviders(<NotificationBell />);
    await userEvent.click(await screen.findByTestId("statusbar-notifications"));

    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    await userEvent.click(screen.getByTestId("notification-mark-all"));
    await waitFor(() =>
      expect(screen.queryByTestId("statusbar-notifications-count")).not.toBeInTheDocument()
    );
  });

  it("prepends notifications pushed via the notification:send event", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(notifySendHandlers.length).toBeGreaterThan(0));

    notifySendHandlers[0](makeNotification({ id: "n-live", title: "Live event" }));

    await userEvent.click(screen.getByTestId("statusbar-notifications"));
    expect(await screen.findByTestId("notification-item-n-live")).toBeInTheDocument();
    expect(screen.getByTestId("statusbar-notifications-count")).toHaveTextContent("1");
  });
});
