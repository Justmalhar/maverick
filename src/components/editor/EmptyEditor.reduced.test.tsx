import { describe, it, expect, vi } from "vitest";

vi.mock("framer-motion", async () => {
  const actual = (await vi.importActual("framer-motion")) as Record<string, unknown>;
  void actual;
  const React = await import("react");
  const stripMotionProps = (props: Record<string, unknown>) => {
    const { whileTap, whileHover, whileFocus, whileDrag, whileInView,
      initial, animate, exit, transition, layout, layoutId,
      variants, drag, dragConstraints, dragElastic, dragMomentum,
      onAnimationStart, onAnimationComplete, onDragStart, onDragEnd,
      ...rest } = props;
    void whileTap; void whileHover; void whileFocus; void whileDrag; void whileInView;
    void initial; void animate; void exit; void transition; void layout; void layoutId;
    void variants; void drag; void dragConstraints; void dragElastic; void dragMomentum;
    void onAnimationStart; void onAnimationComplete; void onDragStart; void onDragEnd;
    return rest;
  };
  const motion = new Proxy({} as Record<string, React.ComponentType<Record<string, unknown>>>, {
    get: (_t, tag) => React.forwardRef<unknown, Record<string, unknown>>(
      (props, ref) => React.createElement(String(tag), { ...stripMotionProps(props), ref })
    ),
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useReducedMotion: () => true,
  };
});

import { renderWithProviders, screen } from "@/test/utils";
import { EmptyEditor } from "./EmptyEditor";
import { ActivityBarItem } from "@/components/activitybar/ActivityBarItem";
import { EditorTab } from "./EditorTab";
import { ProjectItem } from "@/components/primarysidebar/ProjectItem";
import { Panel } from "@/components/panel/Panel";
import { TitleBar } from "@/components/titlebar/TitleBar";
import { FolderTree } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { makeProject, makeWorkspace } from "@/test/fixtures";

describe("reduced-motion branch coverage", () => {
  it("EmptyEditor renders without motion animation values", () => {
    renderWithProviders(<EmptyEditor />);
    expect(screen.getByTestId("empty-editor")).toBeInTheDocument();
  });

  it("ActivityBarItem whileTap=undefined branch", () => {
    renderWithProviders(<ActivityBarItem icon={FolderTree} label="x" onClick={() => {}} testId="ai" />);
    expect(screen.getByTestId("ai")).toBeInTheDocument();
  });

  it("EditorTab layout=false branch", () => {
    renderWithProviders(<EditorTab workspace={makeWorkspace({ id: "z" })} active onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId("editor-tab-z")).toBeInTheDocument();
  });

  it("ProjectItem AnimatePresence reduced branch", () => {
    useWorkbench.setState({ ...useWorkbench.getState(), projects: [], workspaces: [] });
    renderWithProviders(<ProjectItem project={makeProject({ id: "pp" })} />);
    expect(screen.getByTestId("project-item-pp")).toBeInTheDocument();
  });

  it("Panel motion.section reduced branch", () => {
    renderWithProviders(<Panel />);
    expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
  });

  it("TitleBar still renders search/cmd buttons", () => {
    renderWithProviders(<TitleBar />);
    expect(screen.getByTestId("titlebar-quickopen")).toBeInTheDocument();
  });
});
