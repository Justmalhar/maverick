import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  useSourceControl,
  getSourceControlRemoteIndicator,
  __resetAutoFetchForTests,
} from "./useSourceControl";
import type { Branch } from "@/lib/ipc";

function branch(overrides: Partial<Branch> = {}): Branch {
  return { name: "main", isRemote: false, isCurrent: true, ...overrides };
}

/** Dispatch invoke calls by command name. Branch-list factory recomputed each call. */
function mockGit(handlers: {
  branchList?: () => Branch[];
  fetch?: () => unknown;
  pull?: () => unknown;
  push?: () => unknown;
}) {
  vi.mocked(invoke).mockImplementation(((cmd: string) => {
    switch (cmd) {
      case "git_branch_list":
        return Promise.resolve(handlers.branchList ? handlers.branchList() : []);
      case "git_fetch":
        return Promise.resolve(handlers.fetch ? handlers.fetch() : { ok: true });
      case "git_pull":
        return Promise.resolve(handlers.pull ? handlers.pull() : { ok: true });
      case "git_push":
        return Promise.resolve(handlers.push ? handlers.push() : { ok: true });
      default:
        return Promise.reject(new Error(`Unmocked ${cmd}`));
    }
  }) as unknown as typeof invoke);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  __resetAutoFetchForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSourceControlRemoteIndicator", () => {
  it("hidden without repo or upstream", () => {
    expect(
      getSourceControlRemoteIndicator({
        hasRepo: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        busyAction: null,
      }).visible
    ).toBe(false);
    expect(
      getSourceControlRemoteIndicator({
        hasRepo: true,
        upstream: null,
        ahead: 0,
        behind: 0,
        busyAction: null,
      }).visible
    ).toBe(false);
  });

  it("diverged shows ↑N ↓M and is disabled", () => {
    const ind = getSourceControlRemoteIndicator({
      hasRepo: true,
      upstream: "origin/main",
      ahead: 2,
      behind: 3,
      busyAction: null,
    });
    expect(ind.label).toBe("↑2 ↓3");
    expect(ind.disabled).toBe(true);
    expect(ind.action).toBeNull();
  });

  it("behind shows ↓N pull (singular/plural)", () => {
    expect(
      getSourceControlRemoteIndicator({
        hasRepo: true,
        upstream: "u",
        ahead: 0,
        behind: 1,
        busyAction: null,
      })
    ).toMatchObject({ label: "↓1", action: "pull" });
    expect(
      getSourceControlRemoteIndicator({
        hasRepo: true,
        upstream: "u",
        ahead: 0,
        behind: 4,
        busyAction: null,
      }).title
    ).toContain("commits");
  });

  it("ahead shows ↑N push (singular/plural) and respects busyAction", () => {
    expect(
      getSourceControlRemoteIndicator({
        hasRepo: true,
        upstream: "u",
        ahead: 1,
        behind: 0,
        busyAction: null,
      })
    ).toMatchObject({ label: "↑1", action: "push", disabled: false });
    const busy = getSourceControlRemoteIndicator({
      hasRepo: true,
      upstream: "u",
      ahead: 5,
      behind: 0,
      busyAction: "push",
    });
    expect(busy.disabled).toBe(true);
    expect(busy.title).toContain("commits");
  });

  it("in-sync shows Sync (fetch)", () => {
    expect(
      getSourceControlRemoteIndicator({
        hasRepo: true,
        upstream: "u",
        ahead: 0,
        behind: 0,
        busyAction: null,
      })
    ).toMatchObject({ label: "Sync", action: "fetch" });
  });
});

describe("useSourceControl", () => {
  it("no-op summary when worktreePath empty", async () => {
    mockGit({ branchList: () => [branch()] });
    const { result } = renderHook(() => useSourceControl(""));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.hasRepo).toBe(false);
  });

  it("loads current branch ahead/behind/upstream", async () => {
    mockGit({
      branchList: () => [
        branch({ name: "main", isCurrent: false }),
        branch({ name: "feat", isCurrent: true, upstream: "origin/feat", ahead: 1, behind: 0 }),
      ],
    });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.upstream).toBe("origin/feat"));
    expect(result.current.ahead).toBe(1);
    expect(result.current.behind).toBe(0);
    expect(result.current.hasRepo).toBe(true);
    expect(result.current.branch?.name).toBe("feat");
  });

  it("hasRepo true but null branch when no current branch", async () => {
    mockGit({ branchList: () => [branch({ isCurrent: false })] });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    expect(result.current.branch).toBeNull();
    expect(result.current.upstream).toBeNull();
  });

  it("captures branch-list error in localError", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("listfail"));
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.localError).toBe("listfail"));
    expect(result.current.hasRepo).toBe(false);
  });

  it("auto-fetches on mount when upstream set then refreshes branch", async () => {
    const fetch = vi.fn(() => ({ ok: true }));
    let call = 0;
    mockGit({
      branchList: () => {
        call += 1;
        return [
          branch({
            isCurrent: true,
            upstream: "origin/main",
            ahead: 0,
            behind: call > 1 ? 2 : 0,
          }),
        ];
      },
      fetch,
    });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.behind).toBe(2));
  });

  it("does not auto-fetch when no upstream", async () => {
    const fetch = vi.fn(() => ({ ok: true }));
    mockGit({ branchList: () => [branch({ isCurrent: true })], fetch });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("auto-fetch error sets lastRemoteError but keeps branch", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "git_branch_list")
        return Promise.resolve([branch({ isCurrent: true, upstream: "origin/main", ahead: 1 })]);
      if (cmd === "git_fetch") return Promise.reject(new Error("fetchfail"));
      return Promise.reject(new Error(`Unmocked ${cmd}`));
    }) as unknown as typeof invoke);
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.lastRemoteError).toBe("fetchfail"));
    expect(result.current.branch?.ahead).toBe(1);
  });

  it("throttles auto-fetch within window (explicit always overrides)", async () => {
    const fetch = vi.fn(() => ({ ok: true }));
    mockGit({
      branchList: () => [branch({ isCurrent: true, upstream: "origin/main" })],
      fetch,
    });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // auto again — throttled (no new fetch)
    await act(async () => {
      await result.current.refresh({ remote: "auto" });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    // always — bypasses throttle
    await act(async () => {
      await result.current.refresh({ remote: "always" });
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent refresh calls of same/lower mode", async () => {
    let listCalls = 0;
    const pending: Array<(b: Branch[]) => void> = [];
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "git_branch_list") {
        listCalls += 1;
        // First (mount) call resolves immediately; later calls stay pending so
        // we can observe inflight coalescing deterministically.
        if (listCalls === 1) return Promise.resolve([branch({ isCurrent: true })]);
        return new Promise<Branch[]>((res) => pending.push(res));
      }
      return Promise.resolve({ ok: true });
    }) as unknown as typeof invoke);
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.branch?.name).toBe("main"));
    expect(listCalls).toBe(1);

    // Two concurrent never-refreshes share one inflight branch_list call.
    let done: Promise<unknown>;
    act(() => {
      done = Promise.all([
        result.current.refresh({ remote: "never" }),
        result.current.refresh({ remote: "never" }),
      ]);
    });
    expect(listCalls).toBe(2);
    await act(async () => {
      pending.forEach((res) => res([branch({ isCurrent: true })]));
      await done;
    });
  });

  it("upgrades inflight from never to remote", async () => {
    const fetch = vi.fn(() => ({ ok: true }));
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "git_branch_list")
        return new Promise<Branch[]>(() => {
          /* never resolves — keeps the refresh inflight */
        });
      if (cmd === "git_fetch") return Promise.resolve(fetch());
      return Promise.resolve({ ok: true });
    }) as unknown as typeof invoke);
    const { result } = renderHook(() => useSourceControl("/wt", false));
    let rNever: Promise<void>;
    let rAlways: Promise<void>;
    act(() => {
      rNever = result.current.refresh({ remote: "never" });
      rAlways = result.current.refresh({ remote: "always" });
    });
    expect(rNever!).not.toBe(rAlways!);
  });

  it("runRemoteAction blocked: no-repo", async () => {
    mockGit({ branchList: () => [branch({ isCurrent: false })] });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    let res: Awaited<ReturnType<typeof result.current.runRemoteAction>>;
    await act(async () => {
      res = await result.current.runRemoteAction();
    });
    expect(res!).toMatchObject({ ok: false, blocked: "no-repo" });
  });

  it("runRemoteAction blocked: missing-upstream", async () => {
    mockGit({ branchList: () => [branch({ isCurrent: true })] });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.branch?.name).toBe("main"));
    let res: Awaited<ReturnType<typeof result.current.runRemoteAction>>;
    await act(async () => {
      res = await result.current.runRemoteAction();
    });
    expect(res!).toMatchObject({ ok: false, blocked: "missing-upstream" });
  });

  it("runRemoteAction blocked: diverged (contextual)", async () => {
    mockGit({
      branchList: () => [branch({ isCurrent: true, upstream: "origin/main", ahead: 1, behind: 1 })],
    });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.upstream).toBe("origin/main"));
    let res: Awaited<ReturnType<typeof result.current.runRemoteAction>>;
    await act(async () => {
      res = await result.current.runRemoteAction("contextual");
    });
    expect(res!).toMatchObject({ ok: false, blocked: "diverged" });
  });

  it("runRemoteAction fetch success (in-sync)", async () => {
    const fetch = vi.fn(() => ({ ok: true }));
    mockGit({
      branchList: () => [branch({ isCurrent: true, upstream: "origin/main", ahead: 0, behind: 0 })],
      fetch,
    });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.upstream).toBe("origin/main"));
    fetch.mockClear();
    let res: Awaited<ReturnType<typeof result.current.runRemoteAction>>;
    await act(async () => {
      res = await result.current.runRemoteAction("contextual");
    });
    expect(res!).toMatchObject({ ok: true, action: "fetch" });
    expect(fetch).toHaveBeenCalled();
  });

  it("runRemoteAction pull success (behind)", async () => {
    const pull = vi.fn(() => ({ ok: true }));
    mockGit({
      branchList: () => [branch({ isCurrent: true, upstream: "origin/main", ahead: 0, behind: 2 })],
      pull,
    });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.behind).toBe(2));
    let res: Awaited<ReturnType<typeof result.current.runRemoteAction>>;
    await act(async () => {
      res = await result.current.runRemoteAction("contextual");
    });
    expect(res!).toMatchObject({ ok: true, action: "pull" });
    expect(pull).toHaveBeenCalled();
  });

  it("runRemoteAction push success (ahead) via explicit mode", async () => {
    const push = vi.fn(() => ({ ok: true }));
    mockGit({
      branchList: () => [branch({ isCurrent: true, upstream: "origin/main", ahead: 3, behind: 0 })],
      push,
    });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.ahead).toBe(3));
    let res: Awaited<ReturnType<typeof result.current.runRemoteAction>>;
    await act(async () => {
      res = await result.current.runRemoteAction("push");
    });
    expect(res!).toMatchObject({ ok: true, action: "push" });
    expect(push).toHaveBeenCalled();
  });

  it("runRemoteAction error path returns error + sets lastRemoteError", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "git_branch_list")
        return Promise.resolve([
          branch({ isCurrent: true, upstream: "origin/main", ahead: 1, behind: 0 }),
        ]);
      if (cmd === "git_push")
        return Promise.reject("authentication required: bad. Configure your git credential helper.");
      return Promise.resolve({ ok: true });
    }) as unknown as typeof invoke);
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.ahead).toBe(1));
    let res: Awaited<ReturnType<typeof result.current.runRemoteAction>>;
    await act(async () => {
      res = await result.current.runRemoteAction("push");
    });
    expect(res!.ok).toBe(false);
    expect(res!.error).toContain("authentication required");
    await waitFor(() =>
      expect(result.current.lastRemoteError).toContain("authentication required")
    );
  });

  it("normalizeError handles plain object with message", async () => {
    vi.mocked(invoke).mockRejectedValue({ message: "obj-msg" });
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() => expect(result.current.localError).toBe("obj-msg"));
  });

  it("normalizeError falls back to default for opaque errors", async () => {
    vi.mocked(invoke).mockRejectedValue(12345);
    const { result } = renderHook(() => useSourceControl("/wt"));
    await waitFor(() =>
      expect(result.current.localError).toBe("Unknown source control error")
    );
  });

  it("disabled hook short-circuits and resets state", async () => {
    mockGit({ branchList: () => [branch({ isCurrent: true })] });
    const { result, rerender } = renderHook(
      ({ enabled }) => useSourceControl("/wt", enabled),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    rerender({ enabled: false });
    await waitFor(() => expect(result.current.hasRepo).toBe(false));
    // doRefresh guards on enabledRef
    await act(async () => {
      await result.current.refresh({ remote: "never" });
    });
    expect(result.current.hasRepo).toBe(false);
  });

  it("resets when worktreePath changes", async () => {
    mockGit({ branchList: () => [branch({ isCurrent: true, upstream: "origin/main" })] });
    const { result, rerender } = renderHook(
      ({ path }) => useSourceControl(path),
      { initialProps: { path: "/wt-a" } }
    );
    await waitFor(() => expect(result.current.upstream).toBe("origin/main"));
    rerender({ path: "/wt-b" });
    await waitFor(() => expect(result.current.upstream).toBe("origin/main"));
  });

  it("LRU evicts oldest auto-fetch entries beyond limit", async () => {
    // The auto-fetch throttle map is module-level and bounded to 16 entries.
    // Mounting 18 distinct paths (each auto-fetches once) evicts /p0 + /p1.
    const fetch = vi.fn(() => ({ ok: true }));
    mockGit({
      branchList: () => [branch({ isCurrent: true, upstream: "origin/main" })],
      fetch,
    });
    const { rerender } = renderHook(
      ({ path }) => useSourceControl(path),
      { initialProps: { path: "/p0" } }
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); // /p0
    for (let i = 1; i <= 17; i++) {
      rerender({ path: `/p${i}` });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(i + 1));
    }
    // 18 paths touched, map capped at 16 → /p0 evicted. Re-mounting /p0
    // auto-fetches again (no surviving throttle entry).
    const before = fetch.mock.calls.length;
    rerender({ path: "/p0" });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(before + 1));
  });
});
