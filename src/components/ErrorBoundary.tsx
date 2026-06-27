import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(err: unknown): State {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background p-8 font-mono text-foreground">
          <div className="text-[13px] font-semibold">Maverick encountered an error</div>
          <pre className="max-w-[640px] overflow-x-auto rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-[11px] whitespace-pre-wrap break-all text-destructive">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="cursor-pointer rounded-md border border-border-strong bg-secondary px-5 py-1.5 text-[12px] text-foreground hover:bg-muted"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
