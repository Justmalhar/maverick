import type { ThemeRegistrationAny } from "shiki";

// VSCode-format theme derived from src/styles/tokens.css: true-black canvas,
// 96% foreground, purple accent (hsl(263 70% 60%) ≈ #8b5cf6).
export const MAVERICK_DARK: ThemeRegistrationAny = {
  name: "maverick-dark",
  type: "dark",
  colors: {
    "editor.background": "#000000",
    "editor.foreground": "#f5f5f5",
    "editorLineNumber.foreground": "#4d4d4d",
    "editorLineNumber.activeForeground": "#a3a3a3",
    "editorCursor.foreground": "#8b5cf6",
    "editor.selectionBackground": "#8b5cf640",
    "editor.lineHighlightBackground": "#121212",
    "editorWidget.background": "#121212",
    "editorWidget.border": "#242424",
    "diffEditor.insertedTextBackground": "#22c55e22",
    "diffEditor.removedTextBackground": "#ef444422",
    "diffEditor.insertedLineBackground": "#22c55e14",
    "diffEditor.removedLineBackground": "#ef444414",
  },
  tokenColors: [
    { scope: ["comment"], settings: { foreground: "#6b7280", fontStyle: "italic" } },
    { scope: ["string"], settings: { foreground: "#a5d6a7" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#f0abfc" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#c4b5fd" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#93c5fd" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#7dd3fc" } },
    { scope: ["variable", "variable.parameter"], settings: { foreground: "#f5f5f5" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#f9a8d4" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#c4b5fd" } },
    { scope: ["punctuation"], settings: { foreground: "#a3a3a3" } },
  ],
};
