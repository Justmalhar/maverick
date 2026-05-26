import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { InstructionsStep } from "./InstructionsStep";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("InstructionsStep", () => {
  it("calls read_global_md on mount and shows existing content", async () => {
    mockInvoke.mockResolvedValueOnce("Be concise.");
    render(<InstructionsStep />);
    await waitFor(() => {
      const ta = screen.getByTestId("instructions-textarea") as HTMLTextAreaElement;
      expect(ta.value).toBe("Be concise.");
    });
    expect(mockInvoke).toHaveBeenCalledWith("read_global_md");
  });

  it("starts empty when the file only contains the seeded HTML comment", async () => {
    mockInvoke.mockResolvedValueOnce("<!-- Maverick global instructions. -->\n");
    render(<InstructionsStep />);
    await waitFor(() => {
      const ta = screen.getByTestId("instructions-textarea") as HTMLTextAreaElement;
      expect(ta.value).toBe("");
    });
  });

  it("debounces user input and writes via write_global_md", async () => {
    mockInvoke.mockResolvedValueOnce(""); // read_global_md
    render(<InstructionsStep />);
    const ta = await screen.findByTestId("instructions-textarea");
    mockInvoke.mockResolvedValueOnce(undefined); // write_global_md

    vi.useFakeTimers();
    fireEvent.change(ta, { target: { value: "Hi" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.useRealTimers();

    expect(mockInvoke).toHaveBeenCalledWith(
      "write_global_md",
      expect.objectContaining({ contents: "Hi" })
    );
  });

  it("falls back to empty textarea if read_global_md rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("nope"));
    render(<InstructionsStep />);
    await waitFor(() => {
      const ta = screen.getByTestId("instructions-textarea") as HTMLTextAreaElement;
      expect(ta.value).toBe("");
    });
  });
});
