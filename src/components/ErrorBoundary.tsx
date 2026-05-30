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
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            background: "#0a0a0a",
            color: "#fafafa",
            fontFamily: "monospace",
            padding: 32,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>Maverick encountered an error</div>
          <pre
            style={{
              fontSize: 11,
              color: "#f87171",
              background: "#1a0a0a",
              border: "1px solid #3f1a1a",
              borderRadius: 6,
              padding: "12px 16px",
              maxWidth: 640,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              padding: "6px 18px",
              fontSize: 12,
              background: "#27272a",
              color: "#fafafa",
              border: "1px solid #3f3f46",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
