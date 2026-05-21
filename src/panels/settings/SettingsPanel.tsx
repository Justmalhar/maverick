// ⌘, — full settings UI with sidebar nav + section router.
import { useMemo, useState } from "react";
import {
  Settings as SettingsIcon,
  Cpu,
  Plug,
  Palette,
  Bell,
  Keyboard,
  GitBranch,
  Server,
  SlidersHorizontal,
  User,
  Terminal,
  FolderGit2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import GeneralSettings from "./sections/GeneralSettings";
import ModelsSettings from "./sections/ModelsSettings";
import AppearanceSettings from "./sections/AppearanceSettings";
import KeybindingsSettings from "./sections/KeybindingsSettings";
import TerminalPresets from "./sections/TerminalPresets";
import RepositorySettings from "./sections/RepositorySettings";
import NotificationsSettings from "./sections/NotificationsSettings";
import AdvancedSettings from "./sections/AdvancedSettings";
import GitSettings from "./sections/GitSettings";
import MCPsSettings from "./sections/MCPsSettings";
import AccountSettings from "./sections/AccountSettings";

type Section =
  | "general"
  | "models"
  | "providers"
  | "appearance"
  | "notifications"
  | "keybindings"
  | "git"
  | "mcps"
  | "advanced"
  | "account"
  | "terminal"
  | "repositories";

interface NavItem {
  id: Section;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "models", label: "Models", icon: Cpu },
  { id: "providers", label: "Providers", icon: Plug },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "keybindings", label: "Keybindings", icon: Keyboard },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "mcps", label: "MCPs", icon: Server },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
  { id: "account", label: "Account", icon: User },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "repositories", label: "Repositories", icon: FolderGit2 },
];

interface Props {
  /** Controlled open state. If omitted, the panel is treated as always open while mounted. */
  open?: boolean;
  /** Called when the dialog state should change (overlay click, ESC, close button). */
  onOpenChange?: (open: boolean) => void;
  /** Legacy callback — fires when the dialog is closed. */
  onClose?: () => void;
}

export default function SettingsPanel({ open, onOpenChange, onClose }: Props) {
  const [section, setSection] = useState<Section>("general");
  const isOpen = open ?? true;
  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
    if (!next) onClose?.();
  };

  const Content = useMemo(() => {
    switch (section) {
      case "general":
        return <GeneralSettings />;
      case "models":
        return <ModelsSettings />;
      case "providers":
        return <ProvidersSettings />;
      case "appearance":
        return <AppearanceSettings />;
      case "notifications":
        return <NotificationsSettings />;
      case "keybindings":
        return <KeybindingsSettings />;
      case "git":
        return <GitSettings />;
      case "mcps":
        return <MCPsSettings />;
      case "advanced":
        return <AdvancedSettings />;
      case "account":
        return <AccountSettings />;
      case "terminal":
        return <TerminalPresets />;
      case "repositories":
        return <RepositorySettings />;
    }
  }, [section]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="settings-panel"
        className="grid h-[80vh] max-h-[80vh] w-[90vw] max-w-5xl grid-cols-[200px_1fr] gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <nav className="flex flex-col gap-0.5 border-r border-border bg-card/30 p-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                data-testid={`settings-nav-${item.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
                  section === item.id
                    ? "bg-accent/30 text-foreground"
                    : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
          <Separator className="my-1" />
        </nav>
        <div className="overflow-auto p-4">{Content}</div>
      </DialogContent>
    </Dialog>
  );
}

function ProvidersSettings() {
  return (
    <section data-testid="providers-settings" className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Providers</h3>
      <p className="text-xs text-muted-foreground">
        Configure API keys for each backend. Keys are stored in your system keychain.
      </p>
      <div className="rounded-sm border border-border bg-card/30 p-3 text-[11px] text-muted-foreground">
        Provider configuration is managed via the OS keychain. Use{" "}
        <code className="rounded bg-muted/40 px-1">maverick keys set &lt;provider&gt;</code> from a
        terminal or the workspace command palette.
      </div>
    </section>
  );
}
