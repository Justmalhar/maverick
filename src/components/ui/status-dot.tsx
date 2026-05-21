import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const dotVariants = cva("inline-block rounded-full shrink-0", {
  variants: {
    variant: {
      active: "bg-success",
      idle: "bg-muted-foreground/40",
      error: "bg-destructive",
      warning: "bg-warning",
      running: "bg-success animate-pulse",
      stopped: "bg-muted-foreground/40",
    },
    size: {
      sm: "h-1.5 w-1.5",
      default: "h-2 w-2",
      lg: "h-2.5 w-2.5",
    },
  },
  defaultVariants: { variant: "idle", size: "default" },
});

export interface StatusDotProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof dotVariants> {}

export function StatusDot({ className, variant, size, ...props }: StatusDotProps) {
  return <span className={cn(dotVariants({ variant, size }), className)} {...props} />;
}
