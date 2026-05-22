import { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  nav: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

export function SettingsShell({ open, onOpenChange, title, description, nav, footer, children }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="settings-shell"
        className="grid h-[min(680px,86vh)] w-[92vw] !max-w-[960px] grid-cols-[240px_1fr] grid-rows-[auto_1fr_auto] gap-0 overflow-hidden bg-popover p-0 shadow-modal"
        style={{ border: "1px solid hsl(var(--border))" }}
      >
        {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
        <DialogTitle
          className="col-span-2 flex items-center px-5 py-3 text-[12px] font-medium text-foreground"
          style={{ borderBottom: "1px solid hsl(var(--border))" }}
        >
          {title}
        </DialogTitle>
        <div className="row-span-1" style={{ borderRight: "1px solid hsl(var(--border))" }}>
          {nav}
        </div>
        <div className="overflow-y-auto px-8 py-6">{children}</div>
        <div className="col-start-2">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}
