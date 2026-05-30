import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { CaffeinateToggle } from "./CaffeinateToggle";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("CaffeinateToggle", () => {
  it("loads the initial active status and reflects it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ active: true } as never);
    renderWithProviders(<CaffeinateToggle />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("caffeinate_status"));
    expect(await screen.findByText("awake")).toBeInTheDocument();
    expect(screen.getByTestId("statusbar-caffeine")).toHaveAttribute("aria-pressed", "true");
  });

  it("defaults to inactive when the status query fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no sidecar"));
    renderWithProviders(<CaffeinateToggle />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("caffeinate_status"));
    expect(screen.getByText("caffeinate")).toBeInTheDocument();
    expect(screen.getByTestId("statusbar-caffeine")).toHaveAttribute("aria-pressed", "false");
  });

  it("starts caffeinate when toggled on", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ active: false } as never); // status
    renderWithProviders(<CaffeinateToggle />);
    await screen.findByText("caffeinate");

    vi.mocked(invoke).mockResolvedValueOnce({ active: true } as never); // start
    await userEvent.click(screen.getByTestId("statusbar-caffeine"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("caffeinate_start"));
    expect(await screen.findByText("awake")).toBeInTheDocument();
  });

  it("stops caffeinate when toggled off", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ active: true } as never); // status
    renderWithProviders(<CaffeinateToggle />);
    await screen.findByText("awake");

    vi.mocked(invoke).mockResolvedValueOnce({ active: false } as never); // stop
    await userEvent.click(screen.getByTestId("statusbar-caffeine"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("caffeinate_stop"));
    expect(await screen.findByText("caffeinate")).toBeInTheDocument();
  });

  it("ignores a second toggle while the first is in flight", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ active: false } as never); // status
    renderWithProviders(<CaffeinateToggle />);
    await screen.findByText("caffeinate");

    let resolveStart!: (v: { active: boolean }) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<{ active: boolean }>((res) => { resolveStart = res; }) as never
    );
    const btn = screen.getByTestId("statusbar-caffeine");
    await userEvent.click(btn);
    // Second click while busy — must be a no-op (no extra invoke).
    await userEvent.click(btn);

    resolveStart({ active: true });
    await waitFor(() => expect(screen.getByText("awake")).toBeInTheDocument());
    const startCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "caffeinate_start");
    expect(startCalls).toHaveLength(1);
  });

  it("keeps state unchanged when the toggle call fails", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ active: false } as never); // status
    renderWithProviders(<CaffeinateToggle />);
    await screen.findByText("caffeinate");

    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom")); // start fails
    await userEvent.click(screen.getByTestId("statusbar-caffeine"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("caffeinate_start"));
    expect(screen.getByText("caffeinate")).toBeInTheDocument();
  });
});
