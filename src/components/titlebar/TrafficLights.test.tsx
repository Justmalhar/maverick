import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { TrafficLights } from "./TrafficLights";

describe("TrafficLights", () => {
  it("renders the three macOS-style buttons", () => {
    renderWithProviders(<TrafficLights className="extra" />);
    const root = screen.getByTestId("traffic-lights");
    expect(root.className).toMatch(/extra/);
    // Spans are rendered as siblings of testid root. Confirm via count.
    expect(root.querySelectorAll("span").length).toBe(3);
  });

  it("renders without an optional className", () => {
    renderWithProviders(<TrafficLights />);
    expect(screen.getByTestId("traffic-lights")).toBeInTheDocument();
  });
});
