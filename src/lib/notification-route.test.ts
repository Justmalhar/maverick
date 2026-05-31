import { describe, it, expect } from "vitest";
import { routeNotification } from "./notification-route";
import type { Notification } from "@/lib/ipc";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    workspaceId: "ws-1",
    type: "info",
    title: "Build complete",
    body: "All checks passed",
    read: false,
    createdAt: 0,
    ...overrides,
  };
}

describe("routeNotification", () => {
  it("fires an OS notification when the window is unfocused", () => {
    expect(
      routeNotification({
        notification: makeNotification(),
        focused: false,
        visible: true,
        activeWorkspaceId: "ws-1",
      })
    ).toBe("os");
  });

  it("fires an OS notification when the document is hidden even if focused", () => {
    expect(
      routeNotification({
        notification: makeNotification(),
        focused: true,
        visible: false,
        activeWorkspaceId: "ws-1",
      })
    ).toBe("os");
  });

  it("suppresses when focused, visible, and viewing the target workspace", () => {
    expect(
      routeNotification({
        notification: makeNotification({ workspaceId: "ws-1" }),
        focused: true,
        visible: true,
        activeWorkspaceId: "ws-1",
      })
    ).toBe("suppress");
  });

  it("toasts when focused but looking at a different workspace", () => {
    expect(
      routeNotification({
        notification: makeNotification({ workspaceId: "ws-2" }),
        focused: true,
        visible: true,
        activeWorkspaceId: "ws-1",
      })
    ).toBe("toast");
  });

  it("toasts a global (null-workspace) notification while focused", () => {
    expect(
      routeNotification({
        notification: makeNotification({ workspaceId: null }),
        focused: true,
        visible: true,
        activeWorkspaceId: "ws-1",
      })
    ).toBe("toast");
  });

  it("toasts when focused with no active workspace", () => {
    expect(
      routeNotification({
        notification: makeNotification({ workspaceId: "ws-1" }),
        focused: true,
        visible: true,
        activeWorkspaceId: null,
      })
    ).toBe("toast");
  });
});
