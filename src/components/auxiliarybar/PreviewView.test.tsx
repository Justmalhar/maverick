import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { PreviewView } from "./PreviewView";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

function mockRead(res: { content: string; binary?: boolean; unreadable?: boolean } | Error) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "file_read") {
      return res instanceof Error
        ? Promise.reject(res)
        : Promise.resolve({
            content: res.content,
            size: res.content.length,
            binary: res.binary ?? false,
            unreadable: res.unreadable ?? false,
          } as never);
    }
    return Promise.resolve(undefined as never);
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, previewFile: null });
});

describe("PreviewView", () => {
  it("shows the empty state with no preview file", () => {
    renderWithProviders(<PreviewView />);
    expect(screen.getByTestId("preview-empty")).toBeInTheDocument();
  });

  it("reads content and renders the markdown previewer", async () => {
    mockRead({ content: "# Hi" });
    useWorkbench.setState({
      ...initial,
      previewFile: { path: "/wt/a.md", name: "a.md" },
    });
    renderWithProviders(<PreviewView />);
    await waitFor(() => expect(screen.getByTestId("markdown-preview")).toBeInTheDocument());
  });

  it("renders raw source when the file is binary", async () => {
    mockRead({ content: "", binary: true });
    useWorkbench.setState({
      ...initial,
      previewFile: { path: "/wt/a.txt", name: "a.txt" },
    });
    renderWithProviders(<PreviewView />);
    await waitFor(() => expect(screen.getByTestId("raw-preview")).toBeInTheDocument());
  });

  it("renders raw view for markdown when raw flag is set", async () => {
    mockRead({ content: "# Hi" });
    useWorkbench.setState({
      ...initial,
      previewFile: { path: "/wt/a.md", name: "a.md", raw: true },
    });
    renderWithProviders(<PreviewView />);
    await waitFor(() => expect(screen.getByTestId("raw-preview")).toBeInTheDocument());
  });

  it("swallows read errors and renders empty content", async () => {
    mockRead(new Error("denied"));
    useWorkbench.setState({
      ...initial,
      previewFile: { path: "/wt/a.md", name: "a.md" },
    });
    renderWithProviders(<PreviewView />);
    await waitFor(() => expect(screen.getByTestId("markdown-preview")).toBeInTheDocument());
  });

  it("resets content when the preview file is cleared", async () => {
    mockRead({ content: "# Hi" });
    const { rerender } = renderWithProviders(<PreviewView />);
    useWorkbench.setState({
      ...initial,
      previewFile: { path: "/wt/a.md", name: "a.md" },
    });
    rerender(<PreviewView />);
    await waitFor(() => expect(screen.getByTestId("markdown-preview")).toBeInTheDocument());
    useWorkbench.setState({ ...initial, previewFile: null });
    rerender(<PreviewView />);
    await waitFor(() => expect(screen.getByTestId("preview-empty")).toBeInTheDocument());
  });
});
