import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { TrafficLightSpacer } from "./TrafficLightSpacer";

describe("TrafficLightSpacer", () => {
  it("reserves the 78px native traffic-light gutter", () => {
    renderWithProviders(<TrafficLightSpacer className="extra" />);
    const root = screen.getByTestId("traffic-light-spacer");
    expect(root.className).toMatch(/extra/);
    expect(root.className).toMatch(/w-\[78px\]/);
  });

  it("paints no dots of its own — macOS renders the real native lights", () => {
    renderWithProviders(<TrafficLightSpacer />);
    const root = screen.getByTestId("traffic-light-spacer");
    expect(root.querySelectorAll("span").length).toBe(0);
  });

  it("renders without an optional className", () => {
    renderWithProviders(<TrafficLightSpacer />);
    expect(screen.getByTestId("traffic-light-spacer")).toBeInTheDocument();
  });
});
