import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { FirstRunWizard } from "./FirstRunWizard";
import { ThemeProvider } from "@/themes/theme-provider";
import * as hook from "@/hooks/useFirstRun";

function renderWizard() {
  return render(
    <ThemeProvider>
      <FirstRunWizard />
    </ThemeProvider>
  );
}

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function withController(overrides: Partial<ReturnType<typeof hook.useFirstRun>>) {
  vi.spyOn(hook, "useFirstRun").mockReturnValue({
    open: true,
    step: 1,
    status: {
      ok: true,
      error: null,
      firstRun: true,
      wizardVersion: 0,
      currentWizardVersion: 1,
      paths: { configRoot: "/h/.maverick", dbPath: "/d/db.sqlite", logsDir: "/d/logs" },
      settings: {
        schemaVersion: 1,
        wizardVersion: 0,
        firstRunCompletedAt: null,
        theme: "maverick-dark",
        defaultBackend: null,
        notificationsRequestedAt: null,
      },
      notificationPermission: "default",
    },
    advance: vi.fn(),
    back: vi.fn(),
    goTo: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

describe("FirstRunWizard", () => {
  it("renders nothing when open is false", () => {
    withController({ open: false });
    const { container } = renderWizard();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders step 1 by default with no Skip/Back buttons", () => {
    withController({});
    renderWizard();
    expect(screen.getByTestId("firstrun-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("firstrun-step-indicator")).toHaveTextContent("Step 1 / 5");
    expect(screen.queryByRole("button", { name: /^skip$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });

  it("renders 5 numbered step dots in the indicator", () => {
    withController({ step: 3 });
    renderWizard();
    expect(screen.getByTestId("wizard-step-dot-1")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-step-dot-2")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-step-dot-3")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-step-dot-4")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-step-dot-5")).toBeInTheDocument();
  });

  it("shows Skip + Back on step 2", () => {
    mockInvoke.mockResolvedValue("default");
    withController({ step: 2 });
    renderWizard();
    expect(screen.getByRole("button", { name: /^skip$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeInTheDocument();
  });

  it("step 5 primary button reads 'Get started' and calls complete()", async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    mockInvoke.mockResolvedValue([]);
    withController({ step: 5, complete });
    renderWizard();
    const btn = screen.getByRole("button", { name: /get started/i });
    await userEvent.click(btn);
    expect(complete).toHaveBeenCalled();
  });

  it("step 5 Skip button also calls complete()", async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    mockInvoke.mockResolvedValue([]);
    withController({ step: 5, complete });
    renderWizard();
    const skip = screen.getByRole("button", { name: /^skip$/i });
    await userEvent.click(skip);
    expect(complete).toHaveBeenCalled();
  });
});
