import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeStep } from "./WelcomeStep";
import type { BootstrapStatus } from "@/lib/ipc";

const status: BootstrapStatus = {
  ok: true,
  error: null,
  firstRun: true,
  wizardVersion: 0,
  currentWizardVersion: 1,
  paths: { configRoot: "/home/me/.maverick", dbPath: "/data/db.sqlite", logsDir: "/data/logs" },
  settings: {
    schemaVersion: 1, wizardVersion: 0, firstRunCompletedAt: null,
    theme: "maverick-dark", defaultBackend: null, notificationsRequestedAt: null,
  },
  notificationPermission: "default",
};

describe("WelcomeStep", () => {
  it("renders the three created paths", () => {
    render(<WelcomeStep status={status} />);
    expect(screen.getByText("/home/me/.maverick")).toBeInTheDocument();
    expect(screen.getByText("/data/db.sqlite")).toBeInTheDocument();
    expect(screen.getByText("/data/logs")).toBeInTheDocument();
  });

  it("clicking a path copies it to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WelcomeStep status={status} />);
    await userEvent.click(screen.getByText("/home/me/.maverick"));
    expect(writeText).toHaveBeenCalledWith("/home/me/.maverick");
  });
});
