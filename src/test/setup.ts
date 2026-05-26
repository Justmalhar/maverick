import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as React from "react";

afterEach(() => cleanup());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));

// The shell plugin reaches into `window.__TAURI_INTERNALS__` directly instead
// of going through `@tauri-apps/api/core::invoke`, so our existing mock above
// doesn't catch its `open(url)` calls. Provide a separate spy.
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
  Command: class {
    static create() {
      return { execute: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }) };
    }
    execute() {
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    }
  },
}));

// matchMedia polyfill
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverMock {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

// jsdom doesn't implement pointer capture — Radix Select needs these.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// Stable framer-motion mock — strips animation props and renders the element.
vi.mock("framer-motion", () => {
  const stripMotionProps = (props: Record<string, unknown>) => {
    const {
      whileTap, whileHover, whileFocus, whileDrag, whileInView,
      initial, animate, exit, transition, layout, layoutId,
      variants, drag, dragConstraints, dragElastic, dragMomentum,
      onAnimationStart, onAnimationComplete, onDragStart, onDragEnd,
      ...rest
    } = props;
    void whileTap; void whileHover; void whileFocus; void whileDrag; void whileInView;
    void initial; void animate; void exit; void transition; void layout; void layoutId;
    void variants; void drag; void dragConstraints; void dragElastic; void dragMomentum;
    void onAnimationStart; void onAnimationComplete; void onDragStart; void onDragEnd;
    return rest;
  };
  const motion = new Proxy({} as Record<string, React.ComponentType<Record<string, unknown>>>, {
    get: (_target, tag) => {
      const tagName = String(tag);
      const Component = React.forwardRef<unknown, Record<string, unknown>>(
        (props, ref) => React.createElement(tagName, { ...stripMotionProps(props), ref })
      );
      Component.displayName = `motion.${tagName}`;
      return Component;
    },
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useReducedMotion: () => false,
    LazyMotion: ({ children }: { children: React.ReactNode }) => children,
    domAnimation: {},
  };
});

// @lobehub/icons pulls in @lobehub/fluent-emoji which uses directory imports
// that Node's strict ESM resolver rejects under jsdom. We don't render real
// brand SVGs in unit tests — substitute a lightweight stub that preserves the
// compound .Color / .Mono / .Avatar / .Combine / .Text shape.
vi.mock("@lobehub/icons", () => {
  const Stub = (label: string) => {
    const Component: React.ComponentType<{ size?: number }> = ({ size = 24 }) =>
      React.createElement("svg", {
        "data-testid": `icon-${label}`,
        "data-icon": label,
        width: size,
        height: size,
        role: "img",
        "aria-label": label,
      });
    Component.displayName = `Icon(${label})`;
    return Component;
  };
  const compound = (label: string) => {
    const root = Stub(label) as unknown as Record<string, unknown>;
    root.Color = Stub(`${label}.Color`);
    root.Mono = Stub(`${label}.Mono`);
    root.Avatar = Stub(`${label}.Avatar`);
    root.Combine = Stub(`${label}.Combine`);
    root.Text = Stub(`${label}.Text`);
    return root;
  };
  return {
    Antigravity: compound("Antigravity"),
    Anthropic: compound("Anthropic"),
    Claude: compound("Claude"),
    ClaudeCode: compound("ClaudeCode"),
    Codex: compound("Codex"),
    Gemini: compound("Gemini"),
    GeminiCLI: compound("GeminiCLI"),
    Google: compound("Google"),
    Ollama: compound("Ollama"),
    OpenAI: compound("OpenAI"),
    OpenCode: compound("OpenCode"),
  };
});

vi.mock("@hello-pangea/dnd", () => ({
  DragDropContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd?: (r: unknown) => void }) => {
    (globalThis as Record<string, unknown>).__dndOnDragEnd = onDragEnd;
    return React.createElement("div", { "data-testid": "dnd-context" }, children);
  },
  Droppable: ({ children, droppableId }: { children: (provided: unknown, snapshot: unknown) => React.ReactNode; droppableId: string }) =>
    children(
      {
        innerRef: () => {},
        droppableProps: { "data-droppable-id": droppableId },
        placeholder: null,
      },
      { isDraggingOver: droppableId === "in_progress" }
    ),
  Draggable: ({ children, draggableId }: { children: (provided: unknown, snapshot: unknown) => React.ReactNode; draggableId: string }) =>
    children(
      {
        innerRef: () => {},
        draggableProps: { "data-draggable-id": draggableId },
        dragHandleProps: {},
      },
      { isDragging: draggableId === "dragging-task" }
    ),
}));

vi.mock("react-resizable-panels", () => {
  const PanelGroup = ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement("div", { "data-testid": "panel-group", ...rest }, children);
  const Panel = ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement("div", { "data-testid": "panel", ...rest }, children);
  const PanelResizeHandle = (props: Record<string, unknown>) =>
    React.createElement("div", { "data-testid": "panel-handle", ...props });
  return { PanelGroup, Panel, PanelResizeHandle };
});

vi.mock("react-window", () => ({
  FixedSizeList: ({ children, itemCount, itemData }: { children: (p: { index: number; style: Record<string, unknown>; data: unknown }) => React.ReactNode; itemCount: number; itemData?: unknown }) =>
    React.createElement(
      "div",
      { "data-testid": "fixed-size-list" },
      Array.from({ length: itemCount }).map((_, i) =>
        React.createElement(
          React.Fragment,
          { key: i },
          children({ index: i, style: {}, data: itemData })
        )
      )
    ),
}));

vi.mock("pdfjs-dist", () => {
  const fakePage = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  const fakeDoc = {
    numPages: 3,
    getPage: vi.fn().mockResolvedValue(fakePage),
    destroy: vi.fn(),
  };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: vi.fn(() => ({ promise: Promise.resolve(fakeDoc) })),
  };
});

vi.mock("diff2html", () => ({
  html: () => "<div>diff</div>",
  parse: () => [],
}));

// Mock xterm core + addons. Provides shared spies via globalThis.__xterm.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    open = vi.fn();
    write = vi.fn();
    resize = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    constructor(opts?: Record<string, unknown>) {
      this.options = { ...(opts ?? {}) };
      (globalThis as Record<string, unknown>).__xtermLast = this;
    }
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {},
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "markdown" }, children),
}));

vi.mock("remark-gfm", () => ({
  default: () => () => {},
}));

vi.mock("highlight.js/lib/common", () => ({
  default: {
    highlightElement: vi.fn(),
  },
}));

// tinykeys factory — returns a function whose call is the unsubscribe.
vi.mock("tinykeys", () => ({
  tinykeys: vi.fn((_target: unknown, bindings: Record<string, (e: KeyboardEvent) => void>) => {
    (globalThis as Record<string, unknown>).__tinykeysBindings = bindings;
    return () => {
      (globalThis as Record<string, unknown>).__tinykeysBindings = undefined;
    };
  }),
}));

// Register a default fake terminal provider so components that mount
// TerminalPane during tests don't crash with "No TerminalProvider registered".
import { TerminalRegistry, type TerminalHandle } from "@/lib/terminal-provider";
const fakeHandle = (): TerminalHandle => ({
  write: () => {},
  resize: () => {},
  setTheme: () => {},
  focus: () => {},
  dispose: () => {},
  get dimensions() {
    return { cols: 80, rows: 24 };
  },
});
TerminalRegistry.register({ mount: () => fakeHandle() });
