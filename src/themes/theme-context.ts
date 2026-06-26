import { createContext, useContext } from "react";
import type { ThemeDefinition } from "@/lib/ipc";

// Context + accessor for the active theme, kept out of theme-provider.tsx so
// that module exports only its component (Fast Refresh requirement).

export interface ThemeContextValue {
  theme: ThemeDefinition;
  themes: ThemeDefinition[];
  setTheme: (def: ThemeDefinition) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used inside ThemeProvider");
  return ctx;
}
