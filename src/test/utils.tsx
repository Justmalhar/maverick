import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

interface ProviderProps {
  children: ReactNode;
}

function AllProviders({ children }: ProviderProps) {
  return <TooltipProvider delayDuration={0}>{children}</TooltipProvider>;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions
): RenderResult {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from "@testing-library/react";
