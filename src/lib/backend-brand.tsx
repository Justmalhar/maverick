import { Terminal } from "lucide-react";
import {
  Antigravity,
  ClaudeCode,
  Codex,
  GeminiCLI,
  Ollama,
  OpenCode,
} from "@lobehub/icons";
import type { KnownBackendName } from "@/lib/ipc";

type IconProps = { size?: number };
type IconComponent = React.ComponentType<IconProps>;

export interface BackendBrand {
  /** Display label shown in pickers, status bars, etc. */
  label: string;
  /** Brand-correct logo. Falls back to a Lucide icon when no logo ships. */
  Icon: IconComponent;
  /** One-line description for menus. */
  tagline: string;
  /** Where users can learn to install it. */
  installUrl: string;
}

// Each lobehub icon is a compound: the default export is the monochrome
// variant, with .Color / .Avatar / .Combine / .Text hung off it. The re-export
// through @lobehub/icons drops some of that compound shape from TypeScript's
// view, so we project to the variant we want via a small helper.
function color(icon: unknown): IconComponent {
  return (icon as { Color: IconComponent }).Color;
}

// Aider has no brand logo in @lobehub/icons (5.8.0). Use a generic terminal
// mark as the visual placeholder — clearly identifiable as a CLI tool.
function AiderFallback({ size = 24 }: IconProps) {
  return <Terminal size={size} />;
}

export const BACKEND_BRAND: Record<KnownBackendName, BackendBrand> = {
  "claude-code": {
    label: "Claude Code",
    Icon: color(ClaudeCode),
    tagline: "Anthropic's official agentic CLI.",
    installUrl: "https://docs.claude.com/en/docs/claude-code",
  },
  codex: {
    label: "Codex",
    Icon: color(Codex),
    tagline: "OpenAI's coding agent CLI.",
    installUrl: "https://developers.openai.com/codex/cli",
  },
  gemini: {
    label: "Gemini CLI",
    Icon: color(GeminiCLI),
    tagline: "Google's open-source CLI for Gemini.",
    installUrl: "https://geminicli.com/docs/get-started/installation/",
  },
  aider: {
    label: "Aider",
    Icon: AiderFallback,
    tagline: "AI pair programming in your terminal.",
    installUrl: "https://aider.chat/docs/install.html",
  },
  opencode: {
    label: "OpenCode",
    Icon: color(OpenCode),
    tagline: "Open-source terminal coding agent.",
    installUrl: "https://opencode.ai",
  },
  antigravity: {
    label: "Antigravity",
    Icon: color(Antigravity),
    tagline: "Google's agentic coding IDE.",
    installUrl: "https://antigravity.google",
  },
  ollama: {
    label: "Ollama",
    Icon: color(Ollama),
    tagline: "Local models on your machine.",
    installUrl: "https://ollama.com",
  },
};

export function brandFor(name: string): BackendBrand | undefined {
  return (BACKEND_BRAND as Record<string, BackendBrand>)[name];
}
