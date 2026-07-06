import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "@/themes/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Workbench } from "@/components/workbench/Workbench";
import { useShortcuts } from "@/shortcuts/useShortcuts";
import { useAutopilotBridge } from "@/hooks/useAutopilotBridge";
import { XtermProvider } from "@/lib/providers/xterm-provider";
import { TerminalRegistry } from "@/lib/terminal-provider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useSettings } from "@/lib/stores/settings";

// Register the default terminal renderer once at module load.
TerminalRegistry.register(new XtermProvider());

function ShortcutBridge() {
  useShortcuts();
  return null;
}

function AutopilotBridge() {
  useAutopilotBridge();
  return null;
}

export default function App() {
  const [animationsEnabled] = useSettings("appearance.animations", true);
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <MotionConfig reducedMotion={animationsEnabled ? "user" : "always"}>
          <TooltipProvider delayDuration={200}>
            <ShortcutBridge />
            <AutopilotBridge />
            <Workbench />
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
