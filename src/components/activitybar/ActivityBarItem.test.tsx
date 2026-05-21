import { describe, it, expect, vi } from "vitest";
import { FolderTree } from "lucide-react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { ActivityBarItem } from "./ActivityBarItem";

describe("ActivityBarItem", () => {
  it("renders icon, badge, and active strip; invokes onClick", async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <ActivityBarItem
        icon={FolderTree}
        label="Projects"
        shortcut="⌘1"
        active
        badge={3}
        testId="ab-item"
        onClick={onClick}
      />
    );
    const btn = screen.getByTestId("ab-item");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("badge >9 displays as 9+", () => {
    renderWithProviders(
      <ActivityBarItem icon={FolderTree} label="X" badge={12} onClick={() => {}} testId="ab-x" />
    );
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("no shortcut and no badge omit those nodes", () => {
    renderWithProviders(
      <ActivityBarItem icon={FolderTree} label="Plain" onClick={() => {}} testId="ab-plain" badge={0} />
    );
    expect(screen.getByTestId("ab-plain")).toBeInTheDocument();
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
  });
});
