import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ message }: { message?: string }): never {
  throw message ? new Error(message) : ("plain string error" as unknown as never);
}

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs caught render errors; silence to keep output clean.
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    renderWithProviders(
      <ErrorBoundary>
        <div data-testid="ok">all good</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId("ok")).toBeInTheDocument();
  });

  it("catches a thrown Error and shows the fallback with the message", () => {
    renderWithProviders(
      <ErrorBoundary>
        <Boom message="kaboom" />
      </ErrorBoundary>
    );
    expect(screen.getByText("Maverick encountered an error")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    // componentDidCatch logged the error.
    expect(errSpy).toHaveBeenCalledWith(
      "[ErrorBoundary] Uncaught render error:",
      expect.any(Error),
      expect.anything()
    );
  });

  it("wraps a non-Error throw into an Error message", () => {
    renderWithProviders(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("plain string error")).toBeInTheDocument();
  });

  it("Retry clears the error and re-renders children", async () => {
    let shouldThrow = true;
    function Maybe() {
      if (shouldThrow) throw new Error("first render fails");
      return <div data-testid="recovered">recovered</div>;
    }
    renderWithProviders(
      <ErrorBoundary>
        <Maybe />
      </ErrorBoundary>
    );
    expect(screen.getByText("Maverick encountered an error")).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("recovered")).toBeInTheDocument();
  });
});
