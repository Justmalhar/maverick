import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { PermissionsStep } from "./PermissionsStep";
import type { BootstrapStatus } from "@/lib/ipc";

const baseStatus: BootstrapStatus = {
  ok: true,
  error: null,
  firstRun: true,
  wizardVersion: 0,
  currentWizardVersion: 1,
  paths: { configRoot: "/h/.maverick", dbPath: "/d/db.sqlite", logsDir: "/d/logs" },
  settings: {
    schemaVersion: 1, wizardVersion: 0, firstRunCompletedAt: null,
    theme: "maverick-dark", defaultBackend: null, notificationsRequestedAt: null,
  },
  notificationPermission: "default",
};

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("PermissionsStep", () => {
  it("renders Allow + Skip when permission is default", () => {
    render(<PermissionsStep status={baseStatus} onAdvance={vi.fn()} />);
    expect(screen.getByRole("button", { name: /allow notifications/i })).toBeInTheDocument();
    expect(screen.getByTestId("perm-state")).toHaveTextContent(/not yet asked/i);
  });

  it("shows the friendly 'all set' card instead of an Allow button when already granted", () => {
    render(
      <PermissionsStep
        status={{ ...baseStatus, notificationPermission: "granted" }}
        onAdvance={vi.fn()}
      />
    );
    expect(screen.getByTestId("perm-granted-card")).toBeInTheDocument();
    expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /allow notifications/i })).not.toBeInTheDocument();
  });

  it("clicks Allow → invokes request_notification_permission → transitions to granted card", async () => {
    mockInvoke.mockResolvedValueOnce("granted");
    render(<PermissionsStep status={baseStatus} onAdvance={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /allow notifications/i }));
    expect(mockInvoke).toHaveBeenCalledWith("request_notification_permission");
    expect(await screen.findByTestId("perm-granted-card")).toBeInTheDocument();
  });

  it("when permission is unavailable, auto-advances after 800ms", async () => {
    vi.useFakeTimers();
    const onAdvance = vi.fn();
    render(
      <PermissionsStep
        status={{ ...baseStatus, notificationPermission: "unavailable" }}
        onAdvance={onAdvance}
      />
    );
    expect(onAdvance).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(onAdvance).toHaveBeenCalled();
  });

  it("shows denied guidance paragraph when permission is denied", () => {
    render(
      <PermissionsStep
        status={{ ...baseStatus, notificationPermission: "denied" }}
        onAdvance={vi.fn()}
      />
    );
    expect(screen.getByTestId("perm-state")).toHaveTextContent(/off/i);
    expect(screen.getByText(/system settings.*notifications/i)).toBeInTheDocument();
  });
});
