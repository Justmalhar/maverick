import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ThemeDefinition } from "@/lib/ipc";
import MaverickDark from "./definitions/maverick-dark.json";
import OneDarkPro from "./definitions/one-dark-pro.json";
import Dracula from "./definitions/dracula.json";
import Nord from "./definitions/nord.json";
import CatppuccinMocha from "./definitions/catppuccin-mocha.json";
import CatppuccinLatte from "./definitions/catppuccin-latte.json";
import TokyoNight from "./definitions/tokyo-night.json";
import MonokaiPro from "./definitions/monokai-pro.json";
import GithubDark from "./definitions/github-dark.json";
import GithubLight from "./definitions/github-light.json";
import SolarizedDark from "./definitions/solarized-dark.json";
import GruvboxDark from "./definitions/gruvbox-dark.json";

const BUILTIN_THEMES: ThemeDefinition[] = [
  MaverickDark as ThemeDefinition,
  OneDarkPro as ThemeDefinition,
  Dracula as ThemeDefinition,
  Nord as ThemeDefinition,
  CatppuccinMocha as ThemeDefinition,
  CatppuccinLatte as ThemeDefinition,
  TokyoNight as ThemeDefinition,
  MonokaiPro as ThemeDefinition,
  GithubDark as ThemeDefinition,
  GithubLight as ThemeDefinition,
  SolarizedDark as ThemeDefinition,
  GruvboxDark as ThemeDefinition,
];

interface ThemeContextValue {
  theme: ThemeDefinition;
  themes: ThemeDefinition[];
  setTheme: (def: ThemeDefinition) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

function applyToRoot(def: ThemeDefinition) {
  const root = document.documentElement;
  for (const [key, val] of Object.entries(def.ui)) {
    root.style.setProperty(`--${key}`, val);
  }
  root.setAttribute("data-theme", slugify(def.name));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeDefinition>(BUILTIN_THEMES[0]!);

  useEffect(() => {
    applyToRoot(theme);
  }, [theme]);

  const setTheme = useCallback((def: ThemeDefinition) => {
    setThemeState(def);
  }, []);

  const value = useMemo(
    () => ({ theme, themes: BUILTIN_THEMES, setTheme }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used inside ThemeProvider");
  return ctx;
}
