import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent, waitFor, act } from "@/test/utils";
import { BrowserPreview, type BrowserPreviewHandle } from "./BrowserPreview";

function makeProps(overrides: Partial<React.ComponentProps<typeof BrowserPreview>> = {}) {
  return {
    url: "http://localhost:3000",
    visible: true,
    onNavigate: vi.fn(),
    onOpenExternal: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BrowserPreview", () => {
  it("renders a sandboxed iframe whose sandbox omits allow-top-navigation", () => {
    renderWithProviders(<BrowserPreview {...makeProps()} />);
    const frame = screen.getByTestId("browser-iframe");
    expect(frame).toHaveAttribute("src", "http://localhost:3000");
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toMatch(/allow-top-navigation/);
    expect(sandbox).toContain("allow-scripts");
  });

  it("is hidden (and starts suspended) when mounted invisible", () => {
    renderWithProviders(<BrowserPreview {...makeProps({ visible: false })} />);
    expect(screen.getByTestId("browser-preview")).toHaveStyle({ visibility: "hidden" });
    // Mounting invisible starts in the suspended state — no iframe is loaded.
    expect(screen.getByTestId("browser-suspended")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-iframe")).not.toBeInTheDocument();
  });

  it("suspends the iframe after 30s of invisibility and resumes on demand", async () => {
    vi.useFakeTimers();
    const { rerender } = renderWithProviders(<BrowserPreview {...makeProps({ visible: true })} />);
    rerender(<BrowserPreview {...makeProps({ visible: false })} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId("browser-suspended")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-iframe")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("browser-resume"));
    expect(screen.getByTestId("browser-iframe")).toBeInTheDocument();
  });

  it("becoming visible again before the timeout cancels suspension", () => {
    vi.useFakeTimers();
    const { rerender } = renderWithProviders(<BrowserPreview {...makeProps({ visible: true })} />);
    rerender(<BrowserPreview {...makeProps({ visible: false })} />);
    act(() => vi.advanceTimersByTime(10_000));
    rerender(<BrowserPreview {...makeProps({ visible: true })} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId("browser-iframe")).toBeInTheDocument();
  });

  it("reload() handle remounts the iframe", async () => {
    const ref = createRef<BrowserPreviewHandle>();
    renderWithProviders(<BrowserPreview ref={ref} {...makeProps()} />);
    const before = screen.getByTestId("browser-iframe");
    act(() => ref.current?.reload());
    await waitFor(() => expect(screen.getByTestId("browser-iframe")).not.toBe(before));
  });

  it("a successful port probe navigates to that localhost port", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const onNavigate = vi.fn();
    renderWithProviders(<BrowserPreview {...makeProps({ onNavigate })} />);
    await userEvent.click(screen.getByTestId("browser-ports"));
    await userEvent.click(screen.getByTestId("browser-port-3000"));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("http://localhost:3000"));
  });

  it("a failed probe surfaces a dismissible notice and does not navigate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const onNavigate = vi.fn();
    renderWithProviders(<BrowserPreview {...makeProps({ onNavigate })} />);
    await userEvent.click(screen.getByTestId("browser-ports"));
    await userEvent.click(screen.getByTestId("browser-port-5173"));
    await waitFor(() => expect(screen.getByTestId("browser-notice")).toHaveTextContent(":5173"));
    expect(onNavigate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("browser-notice-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("browser-notice")).not.toBeInTheDocument());
  });

  it("shows the X-Frame-Options hint for remote URLs and triggers external open", async () => {
    const onOpenExternal = vi.fn();
    renderWithProviders(
      <BrowserPreview {...makeProps({ url: "https://example.com", onOpenExternal })} />
    );
    expect(screen.getByTestId("browser-xfo-hint")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("browser-open-external"));
    expect(onOpenExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("hides the X-Frame-Options hint for local URLs", () => {
    renderWithProviders(<BrowserPreview {...makeProps({ url: "http://localhost:3000" })} />);
    expect(screen.queryByTestId("browser-xfo-hint")).not.toBeInTheDocument();
  });

  it("an empty URL shows no X-Frame-Options hint", () => {
    renderWithProviders(<BrowserPreview {...makeProps({ url: "" })} />);
    expect(screen.queryByTestId("browser-xfo-hint")).not.toBeInTheDocument();
  });
});
