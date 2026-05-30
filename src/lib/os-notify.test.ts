import { describe, it, expect, beforeEach, vi } from "vitest";

const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();
const sendNotification = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
  sendNotification: (arg: unknown) => sendNotification(arg),
}));

import { dispatchOsNotification } from "./os-notify";

beforeEach(() => {
  isPermissionGranted.mockReset();
  requestPermission.mockReset();
  sendNotification.mockReset();
});

describe("dispatchOsNotification", () => {
  it("sends immediately when permission is already granted", async () => {
    isPermissionGranted.mockResolvedValue(true);
    const ok = await dispatchOsNotification("Title", "Body");
    expect(ok).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledWith({ title: "Title", body: "Body" });
  });

  it("requests permission when not granted, then sends if approved", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");
    const ok = await dispatchOsNotification("T", "B");
    expect(ok).toBe(true);
    expect(sendNotification).toHaveBeenCalled();
  });

  it("does not send when permission is denied", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");
    const ok = await dispatchOsNotification("T", "B");
    expect(ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("returns false (no throw) when the plugin is unavailable", async () => {
    isPermissionGranted.mockRejectedValue(new Error("no plugin"));
    const ok = await dispatchOsNotification("T", "B");
    expect(ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
