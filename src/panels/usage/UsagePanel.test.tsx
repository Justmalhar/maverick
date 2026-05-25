import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import UsagePanel from "./UsagePanel";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, backends: [], workspaces: [] });
});

describe("UsagePanel", () => {
  it("renders the Usage panel heading", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-panel")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
  });

  it("shows fallback backend rows when no backends are configured", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-backends")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("gemini")).toBeInTheDocument();
  });

  it("shows real backend rows when backends are configured", () => {
    useWorkbench.setState({
      ...initial,
      backends: [
        makeBackend({ id: "my-backend", name: "my-backend" }),
        makeBackend({ id: "other", name: "other-agent" }),
      ],
    });
    renderWithProviders(<UsagePanel />);
    expect(screen.getByText("my-backend")).toBeInTheDocument();
    expect(screen.getByText("other-agent")).toBeInTheDocument();
    expect(screen.queryByText("claude-code")).not.toBeInTheDocument();
  });

  it("reflects workspace count in the summary card", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
    });
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("2 active workspaces");
  });

  it("renders all three summary stat cards", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-tokens-today")).toBeInTheDocument();
    expect(screen.getByTestId("usage-stat-requests")).toBeInTheDocument();
    expect(screen.getByTestId("usage-stat-session-cost")).toBeInTheDocument();
  });

  it("shows $0.00 session cost and 0 tokens by default", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-session-cost")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("0");
  });

  it("renders tips section", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByText("Tips")).toBeInTheDocument();
  });
});
