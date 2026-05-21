import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  it("returns the default theme and a list", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme.name).toBeTypeOf("string");
    expect(result.current.themes.length).toBeGreaterThan(0);
    expect(document.documentElement.getAttribute("data-theme")).toBeTruthy();
  });

  it("applyTheme swaps active and sets CSS variables", () => {
    const { result } = renderHook(() => useTheme());
    const target = result.current.themes[2];
    act(() => result.current.applyTheme(target));
    expect(result.current.theme.name).toBe(target.name);
    expect(document.documentElement.getAttribute("data-theme")).toBe(target.name.toLowerCase().replace(/\s+/g, "-"));
  });
});
