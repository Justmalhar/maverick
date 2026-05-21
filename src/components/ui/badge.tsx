import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm px-1 py-px text-[10px] font-medium leading-none",
  {
    variants: {
      variant: {
        default: "bg-primary/20 text-primary",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive/20 text-destructive",
        outline: "border border-border text-foreground",
        success: "bg-success/20 text-success",
        warning: "bg-warning/20 text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
