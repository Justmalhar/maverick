// URL bar with back / forward / refresh / stop / inspector controls.
import { ArrowLeft, ArrowRight, MousePointer2, RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  url: string;
  onUrlChange: (url: string) => void;
  onNavigate: () => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onStop: () => void;
  canBack: boolean;
  canForward: boolean;
  inspecting: boolean;
  onToggleInspect: () => void;
}

export default function BrowserToolbar({
  url,
  onUrlChange,
  onNavigate,
  onBack,
  onForward,
  onRefresh,
  onStop,
  canBack,
  canForward,
  inspecting,
  onToggleInspect,
}: Props) {
  return (
    <div
      data-testid="browser-toolbar"
      className="flex items-center gap-1.5 border-b border-border bg-card/40 px-2 py-1.5"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={!canBack}
        onClick={onBack}
        data-testid="browser-back"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={!canForward}
        onClick={onForward}
        data-testid="browser-forward"
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={onRefresh} data-testid="browser-refresh">
        <RotateCw className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={onStop} data-testid="browser-stop">
        <Square className="h-3.5 w-3.5" />
      </Button>
      <Input
        data-testid="browser-url"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onNavigate()}
        className="flex-1 font-mono text-[11px]"
      />
      <Button
        size="icon-sm"
        variant={inspecting ? "default" : "ghost"}
        onClick={onToggleInspect}
        data-testid="browser-inspect"
        className={cn(inspecting && "ring-1 ring-primary")}
        title="Toggle element inspector (⌘⇧I)"
      >
        <MousePointer2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
