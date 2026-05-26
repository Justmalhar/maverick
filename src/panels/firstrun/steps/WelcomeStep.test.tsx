import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
  it("shows the Maverick brand mark and wordmark", () => {
    render(<WelcomeStep status={status} />);
    const img = screen.getByAltText("Maverick") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toMatch(/app-icon\.png$/);
    expect(screen.getByTestId("firstrun-wordmark")).toHaveTextContent(/welcome to maverick/i);
  });

  it("renders the four feature cards", () => {
    render(<WelcomeStep status={status} />);
    expect(screen.getByText(/run multiple agents/i)).toBeInTheDocument();
    expect(screen.getByText(/make it yours/i)).toBeInTheDocument();
    expect(screen.getByText(/teach it once/i)).toBeInTheDocument();
    expect(screen.getByText(/stay in flow/i)).toBeInTheDocument();
  });

  it("does not surface technical filesystem paths to the user", () => {
    render(<WelcomeStep status={status} />);
    expect(screen.queryByText("/home/me/.maverick")).not.toBeInTheDocument();
    expect(screen.queryByText("/data/db.sqlite")).not.toBeInTheDocument();
    expect(screen.queryByText("/data/logs")).not.toBeInTheDocument();
  });
});
