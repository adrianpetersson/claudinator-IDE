# Side-by-Side Terminal Panes — Design

**Date:** 2026-04-29
**Status:** Draft (awaiting user review)

## Goal

Let the user run multiple terminal panes side by side inside a single Claudinator window. The user's stated workflow: while working on a task, they want to spawn a fresh, unrelated Claude session next to the current one (e.g. to refine a Claude skill in `~/.claude/skills/...` without polluting the task's context). Today the terminal area shows exactly one PTY per task; this design makes it horizontally splittable into N independent panes.

## Non-Goals

- Vertical splits, grids, or a tmux-style nested layout. Horizontal only.
- Drag-and-drop to rearrange panes. Order is creation order; explicit close to remove.
- A task picker on the "+" button. Splits always create scratch panes (no task assignment UI).
- Keyboard navigation between panes (`⌘[` / `⌘]`). Out of scope for v1; can be added later.
- Sharing context between panes. Each pane is an independent Claude/PTY process.

## User Experience

When a task is active, the terminal area looks roughly like today: one pane filling the column. A small **`+`** button sits at the right edge of the pane row's header strip.

Clicking `+` immediately appends a new **scratch pane** to the right of the existing panes. The pane:

- Spawns a fresh Claude Code session in the user's `~/Documents` folder (or `~` as fallback if `~/Documents` doesn't exist).
- Has its own header strip showing `scratch · Documents` (or the basename of the cwd if it ever differs from home in future) plus a close `×` on the right.
- Is independent — its own PTY, its own transcript, its own activity dot, its own status line. Nothing it does affects the task pane next to it.

The user can:

- Click another pane's body to focus it. The focused pane gets a subtle highlighted border on its header strip. The diff modal, file changes panel, status line, and any other "active task" reads use the focused pane's id.
- Click `×` on a pane's header to close it. The PTY disposes, the pane disappears, and the next pane to the left (or right, if it was the leftmost) gets focus. Closing the last pane is a no-op — there's always at least one pane.
- Drag the resize handles between panes (`react-resizable-panels`'s standard handles) to size them.
- Click a task in the left sidebar — if that task is already a pane, focus it; otherwise it replaces the focused **task pane**. Sidebar clicks never touch scratch panes.

On app restart, panes are restored from localStorage in the same order. Scratch panes restore by re-spawning a fresh Claude in their saved cwd; their previous transcript content is restored from the existing terminal-snapshot mechanism, keyed by their synthetic id.

## Architecture

The change is renderer-only. The PTY layer, hook server, session registry, and database don't need to know about panes — they only care about session ids being unique strings.

### Pane state

A new shared type:

```ts
type Pane = { kind: 'task'; taskId: string } | { kind: 'scratch'; id: string; cwd: string };
```

`App.tsx` adds:

```ts
const [panes, setPanes] =
  useState<Pane[]>(/* initial from localStorage or [{kind:'task', taskId: activeTaskId}] */);
const [focusedPaneIndex, setFocusedPaneIndex] = useState(0);
```

`activeTaskId` continues to exist and is derived from `panes[focusedPaneIndex]`:

- If the focused pane is a `task` pane, `activeTaskId = pane.taskId`.
- If the focused pane is a `scratch` pane, `activeTaskId = null`. The diff modal, file changes panel, and any other "show me this task's git state" UI render their existing empty/idle state, which they already do for the no-task case.

This keeps almost all existing logic that reads `activeTaskId` working unchanged.

### Component split

A new component `TerminalPaneGroup` lives between `MainContent` and the existing `TerminalPane`. It owns the horizontal `PanelGroup` and renders one `PaneShell` per entry in `panes`. `PaneShell` is the per-pane wrapper: header strip + the existing `TerminalPane` mounted with the pane's id and cwd.

`MainContent` no longer mounts `TerminalPane` directly. Instead it renders the existing task-tabs strip at the top (when sidebar is collapsed) and below it `TerminalPaneGroup`. Everything else `MainContent` does stays the same.

### Session ids

- Task panes: id is `task.id`, exactly as today. The `sessionRegistry` already uses task id; nothing changes.
- Scratch panes: id is a fresh `scratch-${uuid}` generated when the pane is created. Stored in the pane state. Persists across reloads (so reload reuses the same id and the existing snapshot loads).

### Spawning a scratch pane

`ptyStartDirect` (existing IPC) takes `{ id, cwd, cols, rows, ... }`. For a scratch pane, the renderer calls it with the synthetic id and the user's home dir. The main process spawns Claude exactly the same way it spawns it for tasks (no new code path needed).

Hook routing: each Claude spawn writes a `settings.local.json` for its cwd that points hooks at `127.0.0.1:<hookPort>` with the session id encoded in the URL. The existing flow already attaches the id to hook URLs; scratch panes get the same treatment automatically.

### Persistence

`localStorage` key `panes`: serialized `Pane[]`. On boot:

1. Read `panes` from localStorage.
2. Filter out task panes whose `taskId` is no longer in the DB (task was deleted while the app was closed).
3. If the filtered list is empty, fall back to a single task pane for `activeTaskId` (the existing single-pane behavior).
4. Render.

Focus index is also persisted (`focusedPaneIndex`), clamped to valid range on boot.

## Data Flow

```
User clicks "+"
  → setPanes((p) => [...p, { kind: 'scratch', id: `scratch-${uuid()}`, cwd: defaultScratchCwd() }])
  → React renders new <PaneShell> with that pane
  → <TerminalPane id={pane.id} cwd={pane.cwd} ...> mounts
  → TerminalSessionManager attach() → ptyStartDirect IPC → main process spawns Claude
  → bytes flow back as today, rendered in xterm.js inside the new pane

User clicks pane body
  → setFocusedPaneIndex(thatPaneIndex)
  → diff modal / changes panel re-read activeTaskId (recomputed from focused pane)

User clicks "×" on a pane
  → setPanes((p) => p.filter((_, i) => i !== thatIndex))
  → React unmounts the <PaneShell>; TerminalPane unmount disposes the session
  → focusedPaneIndex clamped if it was past the new last index

User reloads app
  → useState initializer reads localStorage 'panes'
  → filters to valid task panes + scratch panes
  → renders, each pane attaches as above
  → terminal snapshots restore scrollback per id (existing mechanism)
```

## Error Handling

Local-only failures, all soft:

- **Saved task pane references a deleted task** → silently dropped at boot. No error surfaced.
- **Scratch pane's saved cwd no longer exists** → spawn still attempts; PTY layer handles the failure (Claude prints an error). The pane stays open so user can close it; doesn't break the rest of the layout.
- **PTY spawn fails** → existing `TerminalPane` overlay handles this; no new error UI needed.

We deliberately don't validate cwd at boot. Trust the user's filesystem; if it's broken, the user sees it and acts.

## Testing

This work is renderer-side and visual. There are no unit tests we can add that meaningfully cover the value (the actual interactions are spawning real PTYs and rendering xterm canvases). Two options:

1. A small unit test for `derivedActiveTaskId(panes, focusedPaneIndex)` — pure function, easy. Confirms that the "task vs scratch" derivation is correct.
2. A unit test for the persistence shape: round-trip `Pane[]` through localStorage serialization, plus the "filter deleted task" boot logic.

Both are cheap. Skip e2e — manual smoke test (open the app, click `+`, see two Claudes running) is the validation.

## What Changes

**New files:**

- `src/renderer/components/TerminalPaneGroup.tsx` — owns the `PanelGroup` and renders `PaneShell` per entry in `panes`. Receives `panes`, `focusedPaneIndex`, `onFocus`, `onClose`, `onAdd` as props.
- `src/renderer/components/PaneShell.tsx` — header strip (task name + tab kbd hint OR `scratch · Documents`, + close × OR no-close-on-last-pane) + `TerminalPane`. Marks itself focused via a class.
- `src/renderer/panes/derived.ts` — small pure helpers: `derivedActiveTaskId(panes, focusedIndex)`, `loadPanesFromStorage()`, `savePanesToStorage(panes, focusedIndex)`, `defaultScratchCwd()` (returns `~/Documents` when it exists, else `~`).
- `src/renderer/panes/__tests__/derived.test.ts` — covers the pure helpers.

**Modified files:**

- `src/renderer/App.tsx` — replace single `activeTaskId` source-of-truth with `panes + focusedPaneIndex`; derive `activeTaskId` for downstream consumers; pass pane state into `MainContent`.
- `src/renderer/components/MainContent.tsx` — replace direct `<TerminalPane>` render with `<TerminalPaneGroup>`; forward pane props.
- `src/shared/types.ts` — add `Pane` type.

**No changes:**

- Database schema. Drizzle migrations. SQLite anything.
- `src/main/services/ptyManager.ts`, `HookServer.ts`, `WorktreeService.ts`, `TerminalSessionManager.ts`, etc. — they all key by id; ids are still unique strings.
- `TerminalPane.tsx` — used as-is for each pane.
- `FileChangesPanel.tsx`, `DiffViewer.tsx` — they read `activeTaskId`; the value is just the focused-pane's task now.

## Open Questions

These should be resolved during implementation review or by user choice:

1. **Header strip styling for scratch panes.** Probably show `scratch` as a small dim tag next to the cwd basename (`~`). Default plan: the header is `h-10 px-3 flex items-center justify-between` with a `text-muted-foreground` `Terminal` icon, the label, and a close `×`.
2. **What "+" looks like.** Default plan: a single `Plus` icon in a square button at the right edge of the pane row, same height as the header strips. Hover affordance, no label.
3. **First-ever boot.** New users have no `panes` key in localStorage. The fallback creates a single task pane for whatever `activeTaskId` is. If `activeTaskId` is also null, no panes render and the existing "no task selected" empty state shows. Same as today.
