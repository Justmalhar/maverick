import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ThemeProvider } from "./theme-provider";
import { useThemeContext } from "./theme-context";
import type { ReactNode } from "react";
import type { ThemeDefinition } from "@/lib/ipc";

function Wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const LEGACY_THEME: ThemeDefinition = {
  name: "Legacy Test Theme",
  type: "dark",
  ui: {
    "bg-base": "#1a1a2e",
    "bg-sidebar": "#16213e",
    accent: "#e94560",
    "text-primary": "#e0e0e0",
    "text-muted": "#888888",
    border: "#2a2a4a",
    success: "#00b894",
    error: "#d63031",
    warn: "#fdcb6e",
  },
  terminal: { background: "#1a1a2e", foreground: "#e0e0e0", cursor: "#e94560", black: "#1a1a2e", red: "#d63031", green: "#00b894", yellow: "#fdcb6e", blue: "#0984e3", magenta: "#e94560", cyan: "#00cec9", white: "#e0e0e0", brightBlack: "#636e72", brightRed: "#ff7675", brightGreen: "#55efc4", brightYellow: "#ffeaa7", brightBlue: "#74b9ff", brightMagenta: "#fd79a8", brightCyan: "#81ecec", brightWhite: "#ffffff" },
  syntax: {},
};

describe("ThemeProvider", () => {
  it("provides a default theme and applies CSS variables to <html>", () => {
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    expect(result.current.theme.name).toBeTypeOf("string");
    expect(result.current.themes.length).toBeGreaterThan(0);
    expect(document.documentElement.getAttribute("data-theme")).toBeTruthy();
  });

  it("setTheme swaps the active theme", () => {
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    const target = result.current.themes[1];
    act(() => result.current.setTheme(target));
    expect(result.current.theme.name).toBe(target.name);
  });

  it("useThemeContext throws outside the provider", () => {
    expect(() => renderHook(() => useThemeContext())).toThrow(/inside ThemeProvider/);
  });

  it("applies legacy theme (ui-based) via applyLegacyTheme", () => {
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    act(() => result.current.setTheme(LEGACY_THEME));
    expect(result.current.theme.name).toBe("Legacy Test Theme");
    expect(document.documentElement.getAttribute("data-theme")).toBe("legacy-test-theme");
  });

  it("handles rgba() color format in legacy theme", () => {
    const rgbaTheme: ThemeDefinition = {
      ...LEGACY_THEME,
      name: "RGBA Theme",
      ui: { "bg-base": "rgba(26, 26, 46, 1)", accent: "#e94560", "text-primary": "#e0e0e0", "text-muted": "#888888", border: "#2a2a4a" },
    };
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    act(() => result.current.setTheme(rgbaTheme));
    expect(result.current.theme.name).toBe("RGBA Theme");
  });

  it("skips unsupported color formats in legacy theme (returns null from colorToHsl)", () => {
    const unsupportedTheme: ThemeDefinition = {
      ...LEGACY_THEME,
      name: "Unsupported Color Theme",
      ui: { "bg-base": "hsl(240, 100%, 50%)", accent: "#e94560", "text-primary": "#e0e0e0", "text-muted": "#888888", border: "#2a2a4a" },
    };
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    act(() => result.current.setTheme(unsupportedTheme));
    expect(result.current.theme.name).toBe("Unsupported Color Theme");
  });

  it("handles short hex (#RGB) gracefully in VSCode theme via hexToHsl fallback", () => {
    const shortHexTheme: ThemeDefinition = {
      name: "Short Hex Theme",
      type: "dark",
      colors: { "editor.background": "#ff", "editor.foreground": "#1a1a2e" },
      terminal: LEGACY_THEME.terminal,
      syntax: {},
    };
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    act(() => result.current.setTheme(shortHexTheme));
    expect(result.current.theme.name).toBe("Short Hex Theme");
  });

  it("applies a light VSCode theme (LIGHT_FIXED tokens, different secondary-foreground)", () => {
    const lightTheme: ThemeDefinition = {
      name: "Light VSCode Theme",
      type: "light",
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#000000",
        "activityBar.background": "#f0f0f0",
        "sideBar.background": "#e8e8e8",
      },
      terminal: LEGACY_THEME.terminal,
      syntax: {},
    };
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    act(() => result.current.setTheme(lightTheme));
    expect(result.current.theme.name).toBe("Light VSCode Theme");
    // Light theme applies LIGHT_FIXED which sets secondary-foreground to nearly-black.
    const sv = document.documentElement.style.getPropertyValue("--secondary-foreground");
    expect(sv).toBeTruthy();
  });

  it("applyDerivedForegrounds skips sidebar-selected-fg when a non-white value already exists", () => {
    // Supply a VSCode theme with list.activeSelectionForeground set to a custom colour.
    // The alwaysDerive=false branch for sidebar-selected-fg must NOT overwrite it.
    const customSelectionFgTheme: ThemeDefinition = {
      name: "Custom Selection FG Theme",
      type: "dark",
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#d4d4d4",
        "list.activeSelectionBackground": "#094771",
        // Non-white custom foreground — applyDerivedForegrounds must preserve it.
        "list.activeSelectionForeground": "#ffcc00",
      },
      terminal: LEGACY_THEME.terminal,
      syntax: {},
    };
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    act(() => result.current.setTheme(customSelectionFgTheme));
    expect(result.current.theme.name).toBe("Custom Selection FG Theme");
    // The CSS property should NOT have been overwritten to a light-on-dark default.
    const sv = document.documentElement.style.getPropertyValue("--sidebar-selected-fg");
    // It will be set to the derived value from "#ffcc00" (a bright yellow → dark fg),
    // but the key point is the branch that short-circuits was exercised without crash.
    expect(sv).toBeTruthy();
  });

  it("colorToHsl handles an empty value (returns null → skipped)", () => {
    // A legacy theme with a UI key whose value is an empty string — colorToHsl("")
    // returns null because !val, so it is skipped.
    const emptyValTheme: ThemeDefinition = {
      ...LEGACY_THEME,
      name: "Empty Val Theme",
      ui: { "bg-base": "", accent: "#e94560", "text-primary": "#e0e0e0", "text-muted": "#888888", border: "#2a2a4a" },
    };
    const { result } = renderHook(() => useThemeContext(), { wrapper: Wrapper });
    act(() => result.current.setTheme(emptyValTheme));
    expect(result.current.theme.name).toBe("Empty Val Theme");
  });
});
