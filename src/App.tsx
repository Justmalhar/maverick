import { ThemeProvider } from "@/themes/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Workbench } from "@/components/workbench/Workbench";
import { useShortcuts } from "@/shortcuts/useShortcuts";
import { XtermProvider } from "@/lib/providers/xterm-provider";
import { TerminalRegistry } from "@/lib/terminal-provider";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Register the default terminal renderer once at module load.
TerminalRegistry.register(new XtermProvider());

function ShortcutBridge() {
  useShortcuts();
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <ShortcutBridge />
          <Workbench />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
