# Delete Tasks from Kanban Cards — Design

**Date:** 2026-06-27
**Status:** Approved
**Author:** Malhar Ujawane (with Claude Code)

## Problem

There is no direct way to delete a task from the Kanban board. The delete
backend already exists end-to-end and a Delete button lives inside the edit
dialog (`KanbanTaskDialog`), but reaching it requires opening a card into the
modal first. Deletion is therefore undiscoverable and slow.

## Goal

Surface task deletion directly on each Kanban card via **both** a three-dot
(`⋮`) hover menu and a right-click context menu, sharing one code path.

## Non-Goals

- No backend changes. `kanbanDelete` → `kanban_delete` (Tauri) →
  `kanban.delete` (sidecar RPC) → `KanbanStore.delete` already exist and are
  tested.
- No schema/migration changes.
- No styled confirmation dialog (`AlertDialog`). We reuse the existing
  `window.confirm` pattern for consistency and YAGNI.
- The Delete button in `KanbanTaskDialog` stays as-is.

## Existing Architecture (reused, unchanged)

| Layer | Symbol | Location |
|---|---|---|
| Board callback | `remove(id)` | `src/panels/kanban/KanbanBoard.tsx:152` |
| IPC | `kanbanDelete(id): Promise<{ ok: true }>` | `src/lib/tauri.ts:300` |
| Tauri command | `kanban_delete` | `src-tauri/src/commands/kanban.rs:27` |
| Sidecar RPC | `case "kanban.delete"` | `sidecar/rpc-handlers.ts:848` |
| Store | `delete(id): { ok: true }` | `sidecar/kanban-store.ts:108` |

The board's `remove` callback already calls `kanbanDelete`, closes any open
dialog, and refreshes the list. We only need to surface it on the card.

## Design

### 1. New UI primitive

Run `bunx shadcn add context-menu`, producing `src/components/ui/context-menu.tsx`
(Radix `ContextMenu`) and adding the `@radix-ui/react-context-menu` dependency.
This is the shadcn-sanctioned way to add primitives (per CLAUDE.md). The
three-dot menu reuses the already-installed `src/components/ui/dropdown-menu.tsx`.

### 2. Prop threading

Add an optional `onDelete?: (id: string) => void` prop down the existing chain:

- `KanbanBoard` passes its existing `remove` as `onDelete` to `KanbanColumn`
  (`KanbanBoard.tsx:284`).
- `KanbanColumn` forwards `onDelete` to each `KanbanCard`.
- `KanbanCard` accepts `onDelete` and renders the menus only when it is
  provided.

### 3. Card menu (`KanbanCard.tsx`)

A single shared actions list is the source of truth, rendered through both
triggers:

```
actions = [
  { label: "Edit",   icon: Pencil, run: onEdit },
  { label: "Delete", icon: Trash2, run: confirmDelete, destructive: true },
]
```

where `confirmDelete` is:

```
if (window.confirm("Delete this task? This cannot be undone.")) onDelete(task.id);
```

(identical copy to `KanbanTaskDialog.tsx:187`).

- **Three-dot button:** a `⋮` button pinned top-right of the card, wrapped in a
  `DropdownMenu`. Visibility: `opacity-0 group-hover:opacity-100
  focus-visible:opacity-100` — the card root gains `group relative`. The button
  calls `stopPropagation` on pointer/click so it neither triggers the card's
  edit button nor initiates a drag.
- **Right-click:** the draggable card `div` is wrapped in
  `ContextMenuTrigger asChild`. Radix's trigger only adds an `onContextMenu`
  handler and data attributes, so it composes cleanly with
  `@hello-pangea/dnd`'s injected props/refs.
- The destructive Delete item uses `text-destructive` styling from tokens.

### 4. Rendering boundary

The shared actions array avoids duplicating intent across the two Radix
primitives (their item components differ: `DropdownMenuItem` vs
`ContextMenuItem`). Each primitive maps the same array into its own item
component, so adding/removing/relabeling an action is a one-line change.

## Testing

Coverage thresholds are CI-enforced (100% lines, 95% branches).

- `src/panels/kanban/KanbanCard.test.tsx`:
  - three-dot button opens menu; clicking Delete with confirm accepted calls
    `onDelete(task.id)`.
  - clicking Delete with confirm dismissed does not call `onDelete`.
  - Edit menu item calls `onEdit`.
  - right-click opens the context menu and its Delete works the same way.
  - no menu trigger rendered when `onDelete` is undefined.
- `src/panels/kanban/KanbanColumn.test.tsx`: `onDelete` is forwarded to cards.
- Existing dialog/store/board delete tests remain green.

## Acceptance Criteria

- Hovering a card reveals a `⋮` button; clicking it shows Edit + Delete.
- Right-clicking a card shows the same menu.
- Confirming Delete removes the task from the board and DB; cancelling does not.
- `bun run build` passes; `bun run test:coverage` meets thresholds;
  `cargo check` unaffected.
- Feature works in `bun run tauri dev`.
