import { useEffect, useState } from "react";
import type { ThemeDefinition } from "@/lib/ipc";
import MaverickDark from "@/themes/definitions/maverick-dark.json";
import MaverickLight from "@/themes/definitions/maverick-light.json";
import GithubDark from "@/themes/definitions/github-dark.json";
import GithubLight from "@/themes/definitions/github-light.json";
import OneDarkPro from "@/themes/definitions/one-dark-pro.json";
import Dracula from "@/themes/definitions/dracula.json";
import Nord from "@/themes/definitions/nord.json";
import CatppuccinMocha from "@/themes/definitions/catppuccin-mocha.json";
import CatppuccinLatte from "@/themes/definitions/catppuccin-latte.json";
import TokyoNight from "@/themes/definitions/tokyo-night.json";
import MonokaiPro from "@/themes/definitions/monokai-pro.json";
import SolarizedDark from "@/themes/definitions/solarized-dark.json";
import GruvboxDark from "@/themes/definitions/gruvbox-dark.json";

const BUILTIN: ThemeDefinition[] = [
  MaverickDark as ThemeDefinition,
  MaverickLight as ThemeDefinition,
  GithubDark as ThemeDefinition,
  GithubLight as ThemeDefinition,
  OneDarkPro as ThemeDefinition,
  Dracula as ThemeDefinition,
  Nord as ThemeDefinition,
  CatppuccinMocha as ThemeDefinition,
  CatppuccinLatte as ThemeDefinition,
  TokyoNight as ThemeDefinition,
  MonokaiPro as ThemeDefinition,
  SolarizedDark as ThemeDefinition,
  GruvboxDark as ThemeDefinition,
];

export function useTheme() {
  const [active, setActive] = useState<ThemeDefinition>(BUILTIN[0]!);

  function applyTheme(def: ThemeDefinition) {
    const root = document.documentElement;
    for (const [key, val] of Object.entries(def.ui ?? {})) {
      root.style.setProperty(`--${key}`, val);
    }
    root.setAttribute("data-theme", def.name.toLowerCase().replace(/\s+/g, "-"));
    setActive(def);
  }

  useEffect(() => {
    applyTheme(active);
    // intentionally only on mount; subsequent calls flow through applyTheme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { theme: active, themes: BUILTIN, applyTheme };
}
