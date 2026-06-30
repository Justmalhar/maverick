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
  testId?: string;
}

export function SettingsShell({ open, onOpenChange, title, description, nav, footer, children, testId = "settings-shell" }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testId}
        className="grid h-[min(680px,86vh)] w-[92vw] !max-w-[960px] grid-cols-[240px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border border-border bg-popover p-0 shadow-modal"
      >
        {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
        <DialogTitle className="col-span-2 flex items-center border-b border-border px-5 py-3 text-[12px] font-medium text-foreground">
          {title}
        </DialogTitle>
        <div className="row-span-1 border-r border-border">{nav}</div>
        <div className="min-h-0 overflow-y-auto px-8 py-6">{children}</div>
        <div className="col-start-2">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}
