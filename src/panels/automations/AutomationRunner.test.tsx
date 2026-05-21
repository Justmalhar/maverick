import { describe, it, expect, beforeEach, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import AutomationRunner from "./AutomationRunner";

beforeEach(() => {
  vi.mocked(listen).mockReset();
});

describe("AutomationRunner", () => {
  it("renders empty + running header", () => {
    vi.mocked(listen).mockResolvedValue(() => {});
    renderWithProviders(<AutomationRunner running="build" automationName="build" />);
    expect(screen.getByText("build")).toBeInTheDocument();
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
  });

  it("appends step events with matching automation name", async () => {
    let cb: (e: { payload: unknown }) => void = () => {};
    vi.mocked(listen).mockImplementation((async (_event: string, fn: (e: { payload: unknown }) => void) => {
      cb = fn;
      return () => {};
    }) as unknown as typeof listen);
    renderWithProviders(<AutomationRunner running={null} automationName="build" />);
    cb({ payload: { automation: "build", stepIndex: 0, status: "running", output: "x" } });
    cb({ payload: { automation: "other", stepIndex: 0, status: "ok" } });
    cb({ payload: { automation: "build", stepIndex: 1, status: "ok" } });
    cb({ payload: { automation: "build", stepIndex: 2, status: "error" } });
    await waitFor(() => expect(screen.getAllByTestId("runner-event").length).toBe(3));
  });

  it("clears events when running flips", async () => {
    let cb: (e: { payload: unknown }) => void = () => {};
    vi.mocked(listen).mockImplementation((async (_event: string, fn: (e: { payload: unknown }) => void) => {
      cb = fn;
      return () => {};
    }) as unknown as typeof listen);
    const { rerender } = renderWithProviders(<AutomationRunner running={null} />);
    cb({ payload: { automation: "x", stepIndex: 0, status: "running" } });
    rerender(<AutomationRunner running="x" />);
    await waitFor(() => expect(screen.getByText("No runs yet.")).toBeInTheDocument());
  });

  it("silently swallows listen errors", async () => {
    vi.mocked(listen).mockRejectedValue(new Error("nope"));
    renderWithProviders(<AutomationRunner running={null} />);
    await waitFor(() => expect(screen.getByTestId("automation-runner")).toBeInTheDocument());
  });
});
