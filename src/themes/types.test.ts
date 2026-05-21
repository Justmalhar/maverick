import { describe, it, expectTypeOf } from "vitest";
import type { ThemeDefinition, TerminalTheme } from "./types";

describe("themes/types re-exports", () => {
  it("ThemeDefinition matches the lib/ipc shape", () => {
    expectTypeOf<ThemeDefinition>().toMatchTypeOf<{ name: string; type: "dark" | "light" }>();
    expectTypeOf<TerminalTheme>().toMatchTypeOf<{ background: string }>();
  });
});
