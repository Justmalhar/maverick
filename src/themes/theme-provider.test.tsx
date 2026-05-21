import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ThemeProvider, useThemeContext } from "./theme-provider";
import type { ReactNode } from "react";

function Wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

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
});
