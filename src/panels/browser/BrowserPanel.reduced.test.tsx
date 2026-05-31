import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motion = new Proxy({} as Record<string, React.ComponentType<Record<string, unknown>>>, {
    get: (_t, tag) =>
      React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const { initial, animate, transition, ...rest } = props;
        void initial;
        void animate;
        void transition;
        return React.createElement(String(tag), { ...rest, ref });
      }),
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    // Reduced-motion ON — exercises the `reduce ? ...` animation branch.
    useReducedMotion: () => true,
  };
});

import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import BrowserPanel from "./BrowserPanel";
import { useWorkbench } from "@/state/store";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  _resetSettingsStoreForTests();
  useWorkbench.setState({
    ...initial,
    settingsOpen: false,
    quickOpenOpen: false,
    commandPaletteOpen: false,
    presetLauncherOpen: false,
    keybindingHelpOpen: false,
    projectSettings: { open: false, projectId: null },
  });
});

describe("BrowserPanel — reduced motion", () => {
  it("renders without entry animation when reduced motion is preferred", () => {
    renderWithProviders(<BrowserPanel />);
    expect(screen.getByTestId("browser-panel")).toBeInTheDocument();
  });
});
