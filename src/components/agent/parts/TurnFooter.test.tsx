import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TurnFooter, formatTurnDuration } from "./TurnFooter";
import type { AgentFileChange, AgentUsage } from "@/lib/ipc";

const usage = (durationMs: number): AgentUsage => ({ inputTokens: 10, outputTokens: 20, durationMs });

describe("formatTurnDuration", () => {
  it("formats 0ms as 0s", () => {
    expect(formatTurnDuration(0)).toBe("0s");
  });

  it("formats hour-scale durations as Nh Mm", () => {
    expect(formatTurnDuration(3_720_000)).toBe("1h 2m");
  });

  it("omits the minutes suffix on an exact hour", () => {
    expect(formatTurnDuration(7_200_000)).toBe("2h");
  });
});

describe("TurnFooter", () => {
  it("formats sub-minute durations as seconds", () => {
    render(<TurnFooter turnId="t1" meta={{ usage: usage(37000) }} answerText="hi" fileChanges={[]} />);
    expect(screen.getByText("37s")).toBeInTheDocument();
  });

  it("formats durations over a minute as Nm Ss", () => {
    render(<TurnFooter turnId="t1" meta={{ usage: usage(72000) }} answerText="hi" fileChanges={[]} />);
    expect(screen.getByText("1m 12s")).toBeInTheDocument();
  });

  it("omits the seconds suffix on an exact minute", () => {
    render(<TurnFooter turnId="t1" meta={{ usage: usage(60000) }} answerText="hi" fileChanges={[]} />);
    expect(screen.getByText("1m")).toBeInTheDocument();
  });

  it("copies the answer text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true, configurable: true });
    render(<TurnFooter turnId="t1" meta={{ usage: usage(1000) }} answerText="the final answer" fileChanges={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    expect(writeText).toHaveBeenCalledWith("the final answer");
  });

  it("does not throw when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, writable: true, configurable: true });
    render(<TurnFooter turnId="t1" meta={{ usage: usage(1000) }} answerText="answer" fileChanges={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy answer" }));
  });

  it("renders one chip per aggregated file change and wires onOpenFile", async () => {
    const onOpenFile = vi.fn();
    const fileChanges: AgentFileChange[] = [
      { path: "/w/a.ts", additions: 5, deletions: 1, kind: "edit" },
      { path: "/w/b.ts", additions: 2, deletions: 0, kind: "create" },
    ];
    render(<TurnFooter turnId="t1" meta={{ usage: usage(1000) }} answerText="answer" fileChanges={fileChanges} onOpenFile={onOpenFile} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("file-chip-/w/a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("/w/a.ts");
  });

  it("shows an unrecognized-events span with an explanatory title when unknownLines is set", () => {
    render(<TurnFooter turnId="t1" meta={{ usage: usage(1000), unknownLines: 3 }} answerText="answer" fileChanges={[]} />);
    const span = screen.getByText("3 unrecognized events");
    expect(span).toHaveAttribute("title", "The provider emitted lines this client version didn't understand.");
  });

  it("omits the unrecognized-events span when unknownLines is absent", () => {
    render(<TurnFooter turnId="t1" meta={{ usage: usage(1000) }} answerText="answer" fileChanges={[]} />);
    expect(screen.queryByText(/unrecognized events/)).not.toBeInTheDocument();
  });

  it("renders nothing for an empty turn (no meta, no file changes, no answer text)", () => {
    render(<TurnFooter turnId="t1" answerText="" fileChanges={[]} />);
    expect(screen.queryByTestId("turn-footer-t1")).not.toBeInTheDocument();
  });

  it("still renders when meta is absent but there are file changes", () => {
    render(<TurnFooter turnId="t1" answerText="" fileChanges={[{ path: "/w/a.ts", additions: 1, deletions: 0, kind: "edit" }]} />);
    expect(screen.getByTestId("turn-footer-t1")).toBeInTheDocument();
  });
});
