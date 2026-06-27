import type { ThemeRegistrationAny } from "shiki";
import MaverickDark from "@/themes/definitions/maverick-dark.json";

// Single source of truth: the Monaco/Shiki editor theme is derived directly from
// the Maverick Dark theme definition (src/themes/definitions/maverick-dark.json)
// so editor syntax/UI colors can never drift from the workbench theme — the two
// previously diverged (e.g. comment color was #52525b in one and #6b7280 in the
// other). WHY the cast: importing JSON widens `fontStyle` to `string`, but
// shiki's tokenColors expect the literal "italic" | "bold" | … union.
export const MAVERICK_DARK: ThemeRegistrationAny = {
  name: "maverick-dark",
  type: "dark",
  colors: MaverickDark.colors,
  tokenColors: MaverickDark.tokenColors as ThemeRegistrationAny["tokenColors"],
};
