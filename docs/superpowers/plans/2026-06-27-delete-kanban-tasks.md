# Delete Tasks from Kanban Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users delete a Kanban task directly from its card via a three-dot (`⋮`) hover menu and a right-click context menu, reusing the existing delete backend.

**Architecture:** Pure UX surfacing. The delete path (`kanbanDelete` → `kanban_delete` Tauri command → `kanban.delete` sidecar RPC → `KanbanStore.delete`) and the board's `remove(id)` callback already exist. We add a new `context-menu` shadcn primitive, thread the existing `remove` callback down to each card as `onDelete`, and render two triggers (dropdown + context menu) from one shared actions list. Deletion reuses the existing `window.confirm` pattern.

**Tech Stack:** React + TypeScript, Tailwind v4 tokens, Radix UI (`@radix-ui/react-context-menu`, existing `@radix-ui/react-dropdown-menu`), `@hello-pangea/dnd`, Vitest + @testing-library/react, bun.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/components/ui/context-menu.tsx` | Create | Radix ContextMenu primitive (Root/Trigger/Content/Item/Separator/Label), styled to match `dropdown-menu.tsx`. |
| `package.json` | Modify | Add `@radix-ui/react-context-menu` dependency. |
| `src/panels/kanban/KanbanCard.tsx` | Modify | Render `⋮` dropdown + right-click context menu sharing one actions list; new `onDelete` prop; `confirmDelete` handler. |
| `src/panels/kanban/KanbanColumn.tsx` | Modify | Accept and forward `onDelete` to each card. |
| `src/panels/kanban/KanbanBoard.tsx` | Modify | Pass existing `remove` as `onDelete` to `KanbanColumn`. |
| `src/panels/kanban/KanbanCard.test.tsx` | Modify | Tests for menu visibility, dropdown delete (confirm/cancel), edit item, right-click delete. |
| `src/panels/kanban/KanbanColumn.test.tsx` | Modify | Test `onDelete` forwarding to cards. |

**No changes** to `src/lib/tauri.ts`, `src-tauri/**`, `sidecar/**`, or migrations — the delete backend is complete.

---

## Task 1: Add the ContextMenu UI primitive

**Files:**
- Modify: `package.json` (dependencies)
- Create: `src/components/ui/context-menu.tsx`

- [ ] **Step 1: Add the Radix dependency**

Run:
```bash
bun add @radix-ui/react-context-menu
```
Expected: `package.json` gains `"@radix-ui/react-context-menu"` under `dependencies` and `bun.lockb` updates. No errors.

- [ ] **Step 2: Create the primitive**

Create `src/components/ui/context-menu.tsx` (mirrors the trimmed style of `src/components/ui/dropdown-menu.tsx`):

```tsx
import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuGroup = ContextMenuPrimitive.Group;
const ContextMenuPortal = ContextMenuPrimitive.Portal;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors focus:bg-accent/20 focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground", className)}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuGroup,
  ContextMenuPortal,
};
```

- [ ] **Step 3: Type-check the new file**

Run:
```bash
bunx tsc --noEmit
```
Expected: PASS (no errors). If `@radix-ui/react-context-menu` types are missing, re-run Step 1.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb src/components/ui/context-menu.tsx
git commit -m "feat(ui): add shadcn context-menu primitive"
```

---

## Task 2: Thread `onDelete` and render card menus

**Files:**
- Modify: `src/panels/kanban/KanbanCard.tsx`
- Test: `src/panels/kanban/KanbanCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the top-level `describe("KanbanCard", ...)` block in `src/panels/kanban/KanbanCard.test.tsx` (before its closing `});`). Add `fireEvent` to the import from `@/test/utils`:

Change line 4 from:
```tsx
import { renderWithProviders, screen, waitFor } from "@/test/utils";
```
to:
```tsx
import { fireEvent, renderWithProviders, screen, waitFor } from "@/test/utils";
```

Then append:

```tsx
  it("renders no actions menu when onDelete is not provided", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "t1" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.queryByTestId("kanban-card-menu")).not.toBeInTheDocument();
  });

  it("renders the three-dot actions menu when onDelete is provided", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "t1" })} index={0} onEdit={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-card-menu")).toBeInTheDocument();
  });

  it("three-dot menu Delete calls onDelete with the task id after confirm", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "del-1" })} index={0} onEdit={vi.fn()} onDelete={onDelete} />
    );
    await userEvent.click(screen.getByTestId("kanban-card-menu"));
    await userEvent.click(await screen.findByTestId("kanban-menu-delete"));
    expect(onDelete).toHaveBeenCalledWith("del-1");
    confirmSpy.mockRestore();
  });

  it("three-dot menu Delete does nothing when confirm is dismissed", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "del-2" })} index={0} onEdit={vi.fn()} onDelete={onDelete} />
    );
    await userEvent.click(screen.getByTestId("kanban-card-menu"));
    await userEvent.click(await screen.findByTestId("kanban-menu-delete"));
    expect(onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("three-dot menu Edit item calls onEdit", async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "t1" })} index={0} onEdit={onEdit} onDelete={vi.fn()} />
    );
    await userEvent.click(screen.getByTestId("kanban-card-menu"));
    await userEvent.click(await screen.findByTestId("kanban-menu-edit"));
    expect(onEdit).toHaveBeenCalled();
  });

  it("right-click opens the context menu and Delete calls onDelete", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "ctx-1" })} index={0} onEdit={vi.fn()} onDelete={onDelete} />
    );
    fireEvent.contextMenu(screen.getByTestId("kanban-card"));
    await userEvent.click(await screen.findByTestId("kanban-menu-delete"));
    expect(onDelete).toHaveBeenCalledWith("ctx-1");
    confirmSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
bun run test -- src/panels/kanban/KanbanCard.test.tsx
```
Expected: FAIL — the new tests can't find `kanban-card-menu` / `kanban-menu-delete` (those elements don't exist yet).

- [ ] **Step 3: Implement the menus in `KanbanCard.tsx`**

Update the icon import on line 4 from:
```tsx
import { Eye, GitPullRequest, Loader2, Play } from "lucide-react";
```
to:
```tsx
import { Eye, GitPullRequest, Loader2, MoreVertical, Pencil, Play, Trash2 } from "lucide-react";
```

Add these imports after the existing `Button` import (line 6):
```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
```

Add `onDelete` to the `Props` interface (after `onStart`, line 19):
```tsx
  /** When provided, an actions menu (three-dot + right-click) with Delete is shown. */
  onDelete?: (id: string) => void;
```

Update the component signature on line 29 from:
```tsx
export default function KanbanCard({ task, index, diffStat, onEdit, onStart }: Props) {
```
to:
```tsx
export default function KanbanCard({ task, index, diffStat, onEdit, onStart, onDelete }: Props) {
```

Add the delete handler and shared actions list immediately before the `ActionButton` definition (just before line 90, `const ActionButton = () => {`):
```tsx
  const confirmDelete = () => {
    if (onDelete && window.confirm("Delete this task? This cannot be undone.")) {
      onDelete(task.id);
    }
  };

  const menuActions: {
    key: string;
    label: string;
    icon: typeof Pencil;
    run: () => void;
    destructive?: boolean;
  }[] = [
    { key: "edit", label: "Edit", icon: Pencil, run: onEdit },
    { key: "delete", label: "Delete", icon: Trash2, run: confirmDelete, destructive: true },
  ];

  const renderMenuItems = (Item: React.ElementType) =>
    menuActions.map((action) => (
      <Item
        key={action.key}
        data-testid={`kanban-menu-${action.key}`}
        onSelect={action.run}
        className={action.destructive ? "text-destructive focus:text-destructive" : undefined}
      >
        <action.icon className="h-3.5 w-3.5" />
        {action.label}
      </Item>
    ));
```

Update the card root `<div>` className (line 157-160) to add `group relative` so the hover-revealed button anchors correctly. Change:
```tsx
          className={cn(
            "rounded-md border border-border/50 bg-card p-3 text-xs transition-all",
            snapshot.isDragging && "shadow-xl ring-1 ring-primary/50 opacity-90"
          )}
```
to:
```tsx
          className={cn(
            "group relative rounded-md border border-border/50 bg-card p-3 text-xs transition-all",
            snapshot.isDragging && "shadow-xl ring-1 ring-primary/50 opacity-90"
          )}
```

Add the three-dot dropdown as the FIRST child inside that card `<div>` — immediately after the opening `<div ...>` tag (right before the `{/* Branch row ... */}` comment on line 162):
```tsx
          {onDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="kanban-card-menu"
                  aria-label="Task actions"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent/20 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {renderMenuItems(DropdownMenuItem)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
```

Finally, wrap the whole card in a `ContextMenu` when `onDelete` is provided. Change the `return (` block (line 146) so the `Draggable` render-prop returns the card wrapped conditionally. Replace:
```tsx
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
```
with:
```tsx
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => {
        const card = (
        <div
          ref={provided.innerRef}
```
and replace the closing of the render prop (line 234-236):
```tsx
        </div>
      )}
    </Draggable>
  );
```
with:
```tsx
        </div>
        );
        return onDelete ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
            <ContextMenuContent>{renderMenuItems(ContextMenuItem)}</ContextMenuContent>
          </ContextMenu>
        ) : (
          card
        );
      }}
    </Draggable>
  );
```

> NOTE on indentation: the existing card JSX between those two anchors is unchanged — only the wrapper (`const card = (` … `);` + the `return onDelete ? …`) is added around it. Leaving the inner JSX at its current indentation is fine; the formatter is not enforced on indentation here.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
bun run test -- src/panels/kanban/KanbanCard.test.tsx
```
Expected: PASS — all existing tests plus the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/KanbanCard.tsx src/panels/kanban/KanbanCard.test.tsx
git commit -m "feat(kanban): delete tasks via card three-dot and right-click menus"
```

---

## Task 3: Forward `onDelete` through `KanbanColumn`

**Files:**
- Modify: `src/panels/kanban/KanbanColumn.tsx`
- Test: `src/panels/kanban/KanbanColumn.test.tsx`

- [ ] **Step 1: Write the failing test**

Append this test inside `describe("KanbanColumn", ...)` in `src/panels/kanban/KanbanColumn.test.tsx` (before its closing `});`):

```tsx
  it("forwards onDelete to cards so a card delete reaches the handler", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <KanbanColumn
        status="todo"
        tasks={[makeKanbanTask({ id: "col-del", status: "todo" })]}
        diffStatCache={emptyCache}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByTestId("kanban-card-menu"));
    await userEvent.click(await screen.findByTestId("kanban-menu-delete"));
    expect(onDelete).toHaveBeenCalledWith("col-del");
    confirmSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun run test -- src/panels/kanban/KanbanColumn.test.tsx
```
Expected: FAIL — `kanban-card-menu` is not rendered because `KanbanColumn` doesn't accept/forward `onDelete` yet.

- [ ] **Step 3: Implement the forwarding**

In `src/panels/kanban/KanbanColumn.tsx`, add `onDelete` to the `Props` interface (after `onStart`, line 13):
```tsx
  onDelete?: (id: string) => void;
```

Update the component signature on line 30 from:
```tsx
export default function KanbanColumn({ status, tasks, diffStatCache, onEdit, onStart }: Props) {
```
to:
```tsx
export default function KanbanColumn({ status, tasks, diffStatCache, onEdit, onStart, onDelete }: Props) {
```

Add the prop to the `<KanbanCard>` render (after `onStart={onStart}`, line 61):
```tsx
                onDelete={onDelete}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun run test -- src/panels/kanban/KanbanColumn.test.tsx
```
Expected: PASS — all existing tests plus the new one.

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/KanbanColumn.tsx src/panels/kanban/KanbanColumn.test.tsx
git commit -m "feat(kanban): forward onDelete through KanbanColumn"
```

---

## Task 4: Wire the board's `remove` callback into the columns

**Files:**
- Modify: `src/panels/kanban/KanbanBoard.tsx`

- [ ] **Step 1: Pass `remove` as `onDelete`**

In `src/panels/kanban/KanbanBoard.tsx`, the `remove` callback already exists (line 152) and is already passed to the dialog (`onDelete={remove}`, line 303). Add it to the `<KanbanColumn>` render too. Change the column block (lines 284-293) from:
```tsx
            <KanbanColumn
              key={col}
              status={col}
              tasks={filteredTasks
                .filter((t) => t.status === col)
                .sort((a, b) => a.columnOrder - b.columnOrder)}
              diffStatCache={diffStatCache}
              onEdit={(task) => setDialogTask(task)}
              onStart={handleStart}
            />
```
to:
```tsx
            <KanbanColumn
              key={col}
              status={col}
              tasks={filteredTasks
                .filter((t) => t.status === col)
                .sort((a, b) => a.columnOrder - b.columnOrder)}
              diffStatCache={diffStatCache}
              onEdit={(task) => setDialogTask(task)}
              onStart={handleStart}
              onDelete={remove}
            />
```

- [ ] **Step 2: Run the board tests to verify nothing regressed**

Run:
```bash
bun run test -- src/panels/kanban/KanbanBoard.test.tsx
```
Expected: PASS — existing board tests still green (no new behavior assertions needed here; the delete-from-card path is fully covered by Task 2 and Task 3 tests, and the board's `remove` is already covered by existing dialog-delete tests).

- [ ] **Step 3: Commit**

```bash
git add src/panels/kanban/KanbanBoard.tsx
git commit -m "feat(kanban): enable card-level delete on the board"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check**

Run:
```bash
bunx tsc --noEmit
```
Expected: PASS, no errors.

- [ ] **Step 2: Build**

Run:
```bash
bun run build
```
Expected: PASS (production build succeeds).

- [ ] **Step 3: Full test suite with coverage**

Run:
```bash
bun run test:coverage
```
Expected: PASS, coverage thresholds met (lines 100, branches 95, functions 100, statements 100). If a new branch is uncovered, the most likely culprit is the `onDelete ? … : card` fallback in `KanbanCard.tsx` — the existing tests already render cards without `onDelete` (the `card` fallback branch) and with it (the `ContextMenu` branch), so both are exercised; if coverage still flags it, add a render without `onDelete` and assert `screen.getByTestId("kanban-card")` is present.

- [ ] **Step 4: Manual smoke test**

Run:
```bash
bun run tauri dev
```
Then in the Kanban panel:
- Hover a card → a `⋮` button appears top-right. Click it → menu shows Edit + Delete. Click Delete → confirm dialog → task disappears.
- Right-click a card → same menu appears. Delete works.
- Click Edit in either menu → the task edit dialog opens.
Expected: all three behaviors work; no console errors.

- [ ] **Step 5: Final commit (if any manual tweaks were needed)**

```bash
git add -A
git commit -m "test(kanban): finalize card delete coverage"
```
(Skip if the working tree is already clean.)

---

## Self-Review Notes

- **Spec coverage:** context-menu primitive (Task 1) ✓; prop threading board→column→card (Tasks 2-4) ✓; shared actions list rendered through both triggers (Task 2) ✓; `window.confirm` reuse (Task 2) ✓; tests for visibility/confirm/cancel/edit/right-click (Tasks 2-3) ✓; no backend/schema changes ✓.
- **Type consistency:** `onDelete?: (id: string) => void` is identical across `KanbanCard` and `KanbanColumn`; `remove` in `KanbanBoard` has the matching `(id: string) => Promise<void>` signature (assignable to the `void`-returning prop). `renderMenuItems(Item: React.ElementType)` is called with `DropdownMenuItem` and `ContextMenuItem`, both of which accept `onSelect`, `className`, `data-testid`, and children.
- **No placeholders:** every code and command step is concrete.
