import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[60px] w-full rounded-md bg-input px-2 py-1 text-xs text-foreground transition-shadow duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{ border: "1px solid hsl(var(--border))", ...props.style }}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export { Textarea };
