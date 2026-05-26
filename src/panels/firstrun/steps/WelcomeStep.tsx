import { Bot, Palette, BookOpen, Zap } from "lucide-react";
import type { BootstrapStatus } from "@/lib/ipc";

interface FeatureProps {
  icon: typeof Bot;
  title: string;
  description: string;
}

function FeatureCard({ icon: Icon, title, description }: FeatureProps) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] font-medium text-foreground">{title}</span>
        <span className="text-[11px] leading-snug text-muted-foreground">{description}</span>
      </div>
    </div>
  );
}

export function WelcomeStep({ status: _status }: { status: BootstrapStatus }) {
  return (
    <div data-testid="firstrun-step-welcome" className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <img
          src="/app-icon.png"
          alt="Maverick"
          width={56}
          height={56}
          className="rounded-xl shadow-md"
        />
        <div className="flex flex-col gap-1">
          <h2
            className="text-xl font-semibold tracking-tight text-foreground"
            data-testid="firstrun-wordmark"
          >
            Welcome to Maverick
          </h2>
          <p className="max-w-md text-[12px] text-muted-foreground">
            A calmer home for your AI coding assistants. We&apos;ll take a minute to set things up
            the way you like — you can change everything later.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FeatureCard
          icon={Bot}
          title="Run multiple agents"
          description="Claude, Codex, Gemini and friends in one tidy window."
        />
        <FeatureCard
          icon={Palette}
          title="Make it yours"
          description="Pick a theme that matches the mood of your work."
        />
        <FeatureCard
          icon={BookOpen}
          title="Teach it once"
          description="Save instructions every agent will follow across projects."
        />
        <FeatureCard
          icon={Zap}
          title="Stay in flow"
          description="Keyboard-first, with sessions that survive tab switches."
        />
      </div>
    </div>
  );
}
