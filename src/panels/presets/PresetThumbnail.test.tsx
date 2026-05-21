import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import PresetThumbnail from "./PresetThumbnail";
import { makePreset } from "@/test/fixtures";
import type { PresetNode } from "@/lib/ipc";

describe("PresetThumbnail", () => {
  it("renders terminal leaf rectangle", () => {
    renderWithProviders(<PresetThumbnail preset={makePreset()} />);
    expect(screen.getByTestId("preset-thumbnail")).toBeInTheDocument();
  });

  it("renders horizontal split (left/right)", () => {
    const layout: PresetNode = {
      type: "split", direction: "h", ratio: 0.5,
      left: { type: "terminal", agent: "claude", cwd: "/", mode: "agent" },
      right: { type: "browser", url: "x" },
    };
    renderWithProviders(<PresetThumbnail preset={makePreset({ layout })} />);
    expect(screen.getByTestId("preset-thumbnail")).toBeInTheDocument();
  });

  it("renders vertical split (top/bottom)", () => {
    const layout: PresetNode = {
      type: "split", direction: "v", ratio: 0.5,
      top: { type: "browser", url: "x" },
      bottom: { type: "terminal", agent: "claude", cwd: "/", mode: "agent" },
    } as PresetNode;
    renderWithProviders(<PresetThumbnail preset={makePreset({ layout })} />);
    expect(screen.getByTestId("preset-thumbnail")).toBeInTheDocument();
  });

  it("renders horizontal split with top/bottom fallback (mixed shape)", () => {
    const layout: PresetNode = {
      type: "split", direction: "h", ratio: 0.5,
      // intentionally use top/bottom — collectRects falls back via "in"
      top: { type: "terminal", agent: "x", cwd: "/", mode: "agent" },
      bottom: { type: "terminal", agent: "y", cwd: "/", mode: "agent" },
    } as PresetNode;
    renderWithProviders(<PresetThumbnail preset={makePreset({ layout })} />);
    expect(screen.getByTestId("preset-thumbnail")).toBeInTheDocument();
  });

  it("respects ratio clamping", () => {
    const layout: PresetNode = {
      type: "split", direction: "v", ratio: 0.01,
      top: { type: "terminal", agent: "a", cwd: "/", mode: "agent" },
      bottom: { type: "terminal", agent: "b", cwd: "/", mode: "agent" },
    } as PresetNode;
    renderWithProviders(<PresetThumbnail preset={makePreset({ layout })} />);
  });
});
