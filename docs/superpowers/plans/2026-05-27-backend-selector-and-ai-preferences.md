# Backend Selector + AI Preferences Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact shadcn `<Select>` backend picker to `InputBar` (hidden when ≤1 backend), and wire `preferences.general` from `useProjectSettingsStore` into the agent preamble in `AgentView`.

**Architecture:** Feature 1 adds local `selectedBackend` state to `InputBar`, reads `backends` from the workbench store, and exposes the selected ID via an `onBackendChange` callback prop — consumers can ignore it if they don't need it. Feature 2 appends the `general` preference string (if non-empty) to the already-built preamble inside `buildPreamble`, reading from `useProjectSettingsStore.getState()`.

**Tech Stack:** React 18, Zustand, shadcn/ui `Select`, Tailwind v4, Vitest + @testing-library/react, TypeScript strict.

---

## File Map

| File | Change |
|---|---|
| `src/components/editor/agent/InputBar.tsx` | Add `onBackendChange?: (id: string) => void` prop; add `selectedBackend` state; render `<Select>` when `backends.length > 1` |
| `src/components/editor/agent/InputBar.test.tsx` | Add 3 tests: multi-backend shows selector, single/zero hides it, changing fires callback |
| `src/components/editor/agent/AgentView.tsx` | Read `useProjectSettingsStore.getState().data?.preferences.general` in `buildPreamble`; append formatted block when non-empty |
| `src/components/editor/agent/AgentView.test.tsx` | Add 2 tests: general pref injected when set, nothing added when empty/unset |

No new files. No type changes needed — `preferences` is `Record<string, string>` already on `ProjectSettings`.

---

## Task 1: Backend Selector in InputBar — implementation

**Files:**
- Modify: `src/components/editor/agent/InputBar.tsx`

- [ ] **Step 1: Read the current file to understand the shape**

  Already done — the component has:
  - Props: `{ workspace: Workspace; onSubmit: (text: string) => void }`
  - Reads `skills` from `useWorkbench`
  - Returns a `<div data-testid="input-bar">` with textarea + Send button

- [ ] **Step 2: Write the updated InputBar implementation**

  Replace the entire file content with:

  ```tsx
  import { useEffect, useMemo, useRef, useState } from "react";
  import { Paperclip, Send, Sparkles, X } from "lucide-react";
  import { useWorkbench } from "@/state/store";
  import { useSettings } from "@/lib/stores/settings";
  import { attachmentCreate } from "@/lib/tauri";
  import type { Workspace } from "@/lib/ipc";
  import { Button } from "@/components/ui/button";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { cn } from "@/lib/utils";

  interface Props {
    workspace: Workspace;
    onSubmit: (text: string) => void;
    onBackendChange?: (backendId: string) => void;
  }

  interface AttachmentChip {
    ref: string;
    size: number;
  }

  function formatChars(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
    return `${n} chars`;
  }

  export function InputBar({ workspace, onSubmit, onBackendChange }: Props) {
    const skills = useWorkbench((s) => s.skills);
    const backends = useWorkbench((s) => s.backends);
    const [largeTextThreshold] = useSettings("advanced.largeTextThreshold", 5000);
    const [value, setValue] = useState("");
    const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
    const [skillOpen, setSkillOpen] = useState(false);
    const [skillQuery, setSkillQuery] = useState("");
    const [skillIndex, setSkillIndex] = useState(0);
    const [selectedBackend, setSelectedBackend] = useState(workspace.agentBackend);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const filteredSkills = useMemo(() => {
      const q = skillQuery.toLowerCase();
      return skills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 6);
    }, [skills, skillQuery]);

    useEffect(() => {
      const match = /(?:^|\s)\/(\S*)$/.exec(value);
      if (match) {
        setSkillOpen(true);
        setSkillQuery(match[1] ?? "");
        setSkillIndex(0);
      } else {
        setSkillOpen(false);
      }
    }, [value]);

    function applySkill(name: string) {
      setValue((v) => v.replace(/\/(\S*)$/, `/${name} `));
      setSkillOpen(false);
      inputRef.current?.focus();
    }

    function submit() {
      const text = value.trim();
      if (!text) return;
      onSubmit(text);
      setValue("");
      setAttachments([]);
    }

    async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
      const pasted = e.clipboardData.getData("text");
      if (pasted.length <= largeTextThreshold) return;
      e.preventDefault();
      // Capture the caret synchronously — the synthetic event is recycled after await.
      const { selectionStart: start, selectionEnd: end } = e.currentTarget;
      try {
        const result = await attachmentCreate(workspace.worktreePath, pasted);
        setValue((v) => `${v.slice(0, start)}${result.ref}${v.slice(end)}`);
        setAttachments((prev) => [...prev, { ref: result.ref, size: pasted.length }]);
      } catch (err) {
        console.error("attachment create failed", err);
      }
    }

    function removeAttachment(ref: string) {
      setAttachments((prev) => prev.filter((a) => a.ref !== ref));
      setValue((v) => v.replace(ref, "").replace(/\s{2,}/g, " ").trimStart());
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (skillOpen && filteredSkills.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSkillIndex((i) => (i + 1) % filteredSkills.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSkillIndex(
            (i) => (i - 1 + filteredSkills.length) % filteredSkills.length
          );
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const skill = filteredSkills[skillIndex];
          if (skill) applySkill(skill.name);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSkillOpen(false);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey && !skillOpen) {
        e.preventDefault();
        submit();
      }
    }

    function handleBackendChange(id: string) {
      setSelectedBackend(id);
      onBackendChange?.(id);
    }

    return (
      <div
        data-testid="input-bar"
        className="mv-input-bar relative border-t border-border bg-editor px-3 py-2"
      >
        {skillOpen && filteredSkills.length > 0 && (
          <ul
            data-testid="skill-autocomplete"
            className="absolute bottom-full left-3 right-3 mb-1 max-h-40 overflow-auto rounded-sm border border-border bg-popover p-1 text-xs shadow-md"
          >
            {filteredSkills.map((s, i) => (
              <li
                key={s.name}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySkill(s.name);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1",
                  i === skillIndex && "bg-sidebar-hover text-foreground"
                )}
              >
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="font-mono text-foreground">/{s.name}</span>
                <span className="truncate text-muted-foreground">
                  {s.description}
                </span>
              </li>
            ))}
          </ul>
        )}

        {attachments.length > 0 && (
          <ul
            data-testid="attachment-chips"
            className="mb-1.5 flex flex-wrap gap-1.5"
          >
            {attachments.map((a) => (
              <li
                key={a.ref}
                data-testid={`attachment-chip-${a.ref}`}
                className="flex items-center gap-1.5 rounded-sm border border-border bg-card/60 px-2 py-1 text-[11px] text-foreground"
              >
                <Paperclip className="h-3 w-3 text-primary" />
                <span className="font-mono">{a.ref}</span>
                <span className="text-muted-foreground">{formatChars(a.size)}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.ref)}
                  aria-label={`Remove ${a.ref}`}
                  data-testid={`attachment-remove-${a.ref}`}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2 rounded-sm border border-border bg-input px-2 py-1.5 transition-colors duration-100 focus-within:border-primary">
          <textarea
            ref={inputRef}
            data-input-bar
            aria-label="Prompt input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder={`Message ${selectedBackend} — use /skill for templates`}
            className="flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            style={{ maxHeight: 160 }}
          />
          {backends.length > 1 && (
            <Select value={selectedBackend} onValueChange={handleBackendChange}>
              <SelectTrigger
                className="h-6 w-20 shrink-0 border-border/50 text-[11px]"
                data-testid="input-backend-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {backends.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-[11px]">
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="default"
            size="icon-sm"
            onClick={submit}
            aria-label="Send"
            data-testid="input-send"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            <kbd className="font-mono">Enter</kbd> send ·{" "}
            <kbd className="font-mono">Shift+Enter</kbd> newline
          </span>
          <span>0 / 200k tokens</span>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd /Users/malharujawane/Documents/Development/maverick && bun run build 2>&1 | head -40
  ```

  Expected: no TypeScript errors in InputBar.tsx.

---

## Task 2: Backend Selector in InputBar — tests

**Files:**
- Modify: `src/components/editor/agent/InputBar.test.tsx`

- [ ] **Step 1: Write the three new tests**

  Add after the last existing `it(...)` block (before the final closing `}`):

  ```tsx
  describe("backend selector", () => {
    it("hides the selector when there are 0 backends", () => {
      useWorkbench.setState({ ...initial, skills: [], backends: [] });
      renderWithProviders(
        <InputBar workspace={makeWorkspace({ id: "w1", agentBackend: "claude" })} onSubmit={() => {}} />
      );
      expect(screen.queryByTestId("input-backend-select")).not.toBeInTheDocument();
    });

    it("hides the selector when there is exactly 1 backend", () => {
      useWorkbench.setState({
        ...initial,
        skills: [],
        backends: [makeBackend({ id: "claude", name: "claude" })],
      });
      renderWithProviders(
        <InputBar workspace={makeWorkspace({ id: "w1", agentBackend: "claude" })} onSubmit={() => {}} />
      );
      expect(screen.queryByTestId("input-backend-select")).not.toBeInTheDocument();
    });

    it("shows the selector and fires onBackendChange when multiple backends exist", async () => {
      useWorkbench.setState({
        ...initial,
        skills: [],
        backends: [
          makeBackend({ id: "claude", name: "claude" }),
          makeBackend({ id: "codex", name: "codex", active: false }),
        ],
      });
      const onBackendChange = vi.fn();
      renderWithProviders(
        <InputBar
          workspace={makeWorkspace({ id: "w1", agentBackend: "claude" })}
          onSubmit={() => {}}
          onBackendChange={onBackendChange}
        />
      );
      expect(screen.getByTestId("input-backend-select")).toBeInTheDocument();
      // Open the select and pick "codex"
      await userEvent.click(screen.getByTestId("input-backend-select"));
      await userEvent.click(screen.getByText("codex"));
      expect(onBackendChange).toHaveBeenCalledWith("codex");
    });
  });
  ```

  The import for `makeBackend` must be added to the imports line at the top of the test file:

  Change:
  ```tsx
  import { makeSkill, makeWorkspace } from "@/test/fixtures";
  ```
  To:
  ```tsx
  import { makeBackend, makeSkill, makeWorkspace } from "@/test/fixtures";
  ```

- [ ] **Step 2: Run InputBar tests**

  ```bash
  cd /Users/malharujawane/Documents/Development/maverick && bun run vitest run src/components/editor/agent/InputBar.test.tsx 2>&1
  ```

  Expected: all existing tests pass, 3 new tests pass.

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/malharujawane/Documents/Development/maverick && git add src/components/editor/agent/InputBar.tsx src/components/editor/agent/InputBar.test.tsx && git commit -m "feat(input-bar): add compact backend selector (hidden when ≤1 backend)"
  ```

---

## Task 3: AI Preferences Consumer — implementation

**Files:**
- Modify: `src/components/editor/agent/AgentView.tsx`

- [ ] **Step 1: Understand what to change**

  In `AgentView.tsx`, `buildPreamble` calls `instructionsResolve` and joins `global` + `project`.  
  We need to also read `useProjectSettingsStore.getState().data?.preferences?.general` and append it as a labelled block.  
  The `workspace` has a `projectId` we can look up — but `useProjectSettingsStore` is loaded per project externally; by the time `buildPreamble` is called the settings may or may not be loaded. We read synchronously via `getState()` and silently skip if absent.

- [ ] **Step 2: Write the updated AgentView implementation**

  The only changes are:
  1. Add an import for `useProjectSettingsStore`
  2. Modify `buildPreamble` to also read `preferences.general`

  ```tsx
  import { useCallback, useEffect, useRef, useState } from "react";
  import type { Message, Workspace } from "@/lib/ipc";
  import { messagesList, messageAppend, ptyWrite, instructionsResolve } from "@/lib/tauri";
  import { recordUsageEstimate } from "@/hooks/useContextUsage";
  import { useProjectSettingsStore } from "@/lib/stores/project-settings";
  import { MessageList } from "./MessageList";
  import { InputBar } from "./InputBar";

  interface Props {
    workspace: Workspace;
  }

  /** Prepend the resolved instruction files to the very first prompt of a session. */
  async function buildPreamble(worktreePath: string): Promise<string> {
    try {
      const instr = await instructionsResolve(worktreePath);
      const parts = [instr.global, instr.project].filter(Boolean);
      const generalPref = useProjectSettingsStore.getState().data?.preferences?.general?.trim();
      if (generalPref) {
        parts.push(`--- Project Preferences ---\n${generalPref}`);
      }
      return parts.join("\n\n");
    } catch {
      return "";
    }
  }

  export function AgentView({ workspace }: Props) {
    const [messages, setMessages] = useState<Message[]>([]);
    // A fresh session (no persisted history) gets the instruction preamble on its
    // first prompt only; the ref guards against double-injection within a mount.
    const freshSessionRef = useRef(false);
    const preambleSentRef = useRef(false);
    const messagesRef = useRef<Message[]>([]);

    useEffect(() => {
      messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
      if (!workspace.sessionId) return;
      let cancelled = false;
      preambleSentRef.current = false;
      messagesList(workspace.sessionId)
        .then((list) => {
          if (cancelled) return;
          setMessages(list);
          freshSessionRef.current = list.length === 0;
          void recordUsageEstimate(workspace.sessionId, list, workspace.agentBackend).catch(
            () => {}
          );
        })
        .catch(() => {
          if (cancelled) return;
          setMessages([]);
          freshSessionRef.current = true;
        });
      return () => {
        cancelled = true;
      };
    }, [workspace.sessionId, workspace.agentBackend]);

    const onSubmit = useCallback(
      async (text: string) => {
        // Optimistically append the user message; the sidecar will persist it.
        const optimistic: Message = {
          id: `tmp-${Date.now()}`,
          sessionId: workspace.sessionId,
          role: "user",
          content: text,
          createdAt: Math.floor(Date.now() / 1000),
        };
        const nextMessages = [...messagesRef.current, optimistic];
        setMessages(nextMessages);

        try {
          await messageAppend(workspace.sessionId, "user", text);
          void recordUsageEstimate(
            workspace.sessionId,
            nextMessages,
            workspace.agentBackend
          ).catch(() => {});
          const ptyId = workspace.id;
          let toSend = text;
          if (freshSessionRef.current && !preambleSentRef.current) {
            preambleSentRef.current = true;
            const preamble = await buildPreamble(workspace.worktreePath);
            if (preamble) toSend = `${preamble}\n\n${text}`;
          }
          if (ptyId) await ptyWrite(ptyId, `${toSend}\n`);
        } catch (e) {
          console.error("submit failed", e);
        }
      },
      [workspace]
    );

    return (
      <section
        data-testid={`agent-view-${workspace.id}`}
        className="mv-agent-view flex h-full w-full flex-col"
      >
        <div className="flex-1 overflow-hidden">
          <MessageList messages={messages} />
        </div>
        <InputBar workspace={workspace} onSubmit={onSubmit} />
      </section>
    );
  }
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd /Users/malharujawane/Documents/Development/maverick && bun run build 2>&1 | head -40
  ```

  Expected: no new TypeScript errors.

---

## Task 4: AI Preferences Consumer — tests

**Files:**
- Modify: `src/components/editor/agent/AgentView.test.tsx`

- [ ] **Step 1: Add the import for useProjectSettingsStore**

  At the top of `AgentView.test.tsx`, after the existing imports, add:

  ```tsx
  import { useProjectSettingsStore } from "@/lib/stores/project-settings";
  ```

- [ ] **Step 2: Reset the project settings store in `beforeEach`**

  Change the `beforeEach` block from:
  ```tsx
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
    useWorkbench.setState({ ...initial, skills: [] });
  });
  ```

  To:
  ```tsx
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
    useWorkbench.setState({ ...initial, skills: [] });
    useProjectSettingsStore.getState().reset();
  });
  ```

- [ ] **Step 3: Write the two new preference tests**

  Add after the last existing `it(...)` block (before the final closing `}`):

  ```tsx
  it("appends preferences.general to the preamble when set", async () => {
    // Seed the store with a general preference
    useProjectSettingsStore.setState({
      projectId: "proj-1",
      status: "loaded",
      data: {
        name: "demo",
        rootPath: "/tmp/demo",
        workspaces: { branchFrom: "main", filesToCopy: [] },
        remote: "",
        previewUrl: "",
        scripts: { setup: "", run: "", archive: "" },
        preferences: { general: "Always add tests." },
      },
      dirty: {},
      lastError: null,
    });
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      if (cmd === "instructions_resolve")
        return Promise.resolve({ global: "GLOBAL", project: "", projectSource: null });
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1", worktreePath: "/wt" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "do it{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_write",
        expect.objectContaining({
          data: expect.stringContaining("--- Project Preferences ---\nAlways add tests."),
        })
      )
    );
  });

  it("does not append a preferences block when preferences.general is empty or unset", async () => {
    useProjectSettingsStore.setState({
      projectId: "proj-1",
      status: "loaded",
      data: {
        name: "demo",
        rootPath: "/tmp/demo",
        workspaces: { branchFrom: "main", filesToCopy: [] },
        remote: "",
        previewUrl: "",
        scripts: { setup: "", run: "", archive: "" },
        preferences: { general: "" },
      },
      dirty: {},
      lastError: null,
    });
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      if (cmd === "instructions_resolve")
        return Promise.resolve({ global: "GLOBAL", project: "", projectSource: null });
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1", worktreePath: "/wt" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "do it{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", expect.objectContaining({
        data: "GLOBAL\n\ndo it\n",
      }))
    );
    const ptyCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "pty_write");
    expect(ptyCalls[0]?.[1]).not.toHaveProperty("data", expect.stringContaining("--- Project Preferences ---"));
  });
  ```

- [ ] **Step 4: Run AgentView tests**

  ```bash
  cd /Users/malharujawane/Documents/Development/maverick && bun run vitest run src/components/editor/agent/AgentView.test.tsx 2>&1
  ```

  Expected: all existing tests pass (12 total including the 2 new ones).

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/malharujawane/Documents/Development/maverick && git add src/components/editor/agent/AgentView.tsx src/components/editor/agent/AgentView.test.tsx && git commit -m "feat(agent-view): append preferences.general to agent preamble"
  ```

---

## Task 5: Full coverage check

- [ ] **Step 1: Run full test suite with coverage**

  ```bash
  cd /Users/malharujawane/Documents/Development/maverick && bun run test:coverage 2>&1 | tail -40
  ```

  Expected: lines 100%, branches ≥95%, functions 100%, statements 100% — or at minimum the two touched files hit threshold.

- [ ] **Step 2: If coverage fails, identify the uncovered branch**

  Coverage report will point to specific lines. Common gaps:
  - `handleBackendChange` not called with undefined `onBackendChange` — the `?.()` optional call covers this branch.
  - `buildPreamble` catch path — already tested by existing "falls back to clean prompt" test.

- [ ] **Step 3: Final commit if any coverage fixes needed**

  ```bash
  cd /Users/malharujawane/Documents/Development/maverick && git add -p && git commit -m "test: fix coverage gaps for backend selector and ai prefs"
  ```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| InputBar: initialized with `workspace.agentBackend` | Task 1 — `useState(workspace.agentBackend)` |
| InputBar: compact trigger ~80px left of Send | Task 1 — `h-6 w-20 shrink-0` inside the flex row |
| InputBar: lists all backends | Task 1 — maps `backends` array |
| InputBar: updating passes selected backend ID | Task 1 — `onBackendChange?.(id)` callback |
| InputBar: hidden when ≤1 backend | Task 1 — `{backends.length > 1 && ...}` |
| Tests: selector shown with multiple backends | Task 2 |
| Tests: selector hidden with 0 or 1 backends | Task 2 |
| Tests: changing backend fires callback | Task 2 |
| AgentView: preferences.general appended to preamble | Task 3 |
| AgentView: format `--- Project Preferences ---\n{pref}` | Task 3 |
| AgentView: not appended when empty/unset | Task 3 |
| Tests: general pref included when set | Task 4 |
| Tests: nothing added when empty | Task 4 |

No gaps found.

**Placeholder scan:** No TBD/TODO/similar markers. All code blocks are complete.

**Type consistency:** `onBackendChange?: (backendId: string) => void` — `string` used consistently. `preferences?.general` — `preferences` is `Record<string, string>` so `.general` is `string | undefined`, `.trim()` is called after a truthiness check.
