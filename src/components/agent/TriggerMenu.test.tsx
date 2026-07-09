import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TriggerMenu } from "./TriggerMenu";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({ fileSearch: vi.fn().mockResolvedValue({ hits: [{ rel: "scripts/db-repl.ts" }], truncated: false }) }));

const caps = {
  models: [], reasoningLevels: [], supportsInterrupt: true, supportsConversationRewind: true,
  slashCommands: [{ name: "/compact", description: "Compact context" }, { name: "/review", description: "Review changes" }],
};

describe("TriggerMenu", () => {
  it("lists slash commands filtered by the query and picks on click", async () => {
    const onPick = vi.fn();
    render(<TriggerMenu worktreePath="/w" caps={caps} draft="/comp" caret={5} onPick={onPick} />);
    expect(await screen.findByText("/compact")).toBeInTheDocument();
    expect(screen.queryByText("/review")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("/compact"));
    expect(onPick).toHaveBeenCalledWith({ text: "/compact ", caret: 9 });
  });

  it("lists file hits for @ queries", async () => {
    render(<TriggerMenu worktreePath="/w" caps={caps} draft="fix @db" caret={7} onPick={() => {}} />);
    await waitFor(() => expect(tauri.fileSearch).toHaveBeenCalledWith("/w", "db", 8));
    expect(await screen.findByText("scripts/db-repl.ts")).toBeInTheDocument();
  });

  it("renders nothing without an active trigger", () => {
    const { container } = render(<TriggerMenu worktreePath="/w" caps={caps} draft="plain text" caret={10} onPick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
