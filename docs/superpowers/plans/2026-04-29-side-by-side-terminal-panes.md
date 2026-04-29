# Side-by-Side Terminal Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terminal area horizontally splittable into N independent panes — each pane is either an existing task (with its worktree) or a fresh "scratch" Claude session in `~/Documents`. Click `+` to add a scratch pane, click `×` to close.

**Architecture:** Renderer-only change. Add a `Pane` discriminated union (`task` | `scratch`) and replace `MainContent`'s direct `<TerminalPane>` mount with a new `<TerminalPaneGroup>` that renders one `<PaneShell>` per entry inside a horizontal `react-resizable-panels` group. Existing `activeTaskId` becomes a derivation of "the focused pane's task id" so all downstream consumers (diff modal, file changes panel) keep working unchanged.

**Tech Stack:** React 18, TypeScript, `react-resizable-panels` (already a dep), Vitest, Tailwind. No new runtime deps. PTY layer / hook server / DB are untouched — they key sessions by id, and pane ids are still unique strings.

**Spec:** `docs/superpowers/specs/2026-04-29-side-by-side-terminal-panes-design.md`

---

## Files to be Created or Modified

**Created:**

- `src/renderer/panes/derived.ts` — pure helpers: `Pane` type, `derivedActiveTaskId`, `defaultScratchCwd`, `loadPanesFromStorage`, `savePanesToStorage`, `generateScratchId`.
- `src/renderer/panes/__tests__/derived.test.ts` — vitest unit tests for the helpers.
- `src/renderer/components/PaneShell.tsx` — header strip (label + close ×) + `<TerminalPane>`. Marks itself focused.
- `src/renderer/components/TerminalPaneGroup.tsx` — horizontal `PanelGroup` of `PaneShell`s + the trailing `+` button.

**Modified:**

- `src/shared/types.ts` — add `Pane` exported type.
- `src/renderer/App.tsx` — add `panes` + `focusedPaneIndex` state, derive `activeTaskId` from them, persist to localStorage, pass them into `MainContent`.
- `src/renderer/components/MainContent.tsx` — replace direct `<TerminalPane>` with `<TerminalPaneGroup>`; thread the new pane props.

**No backend changes.** No db schema migrations. No new IPC.

---

## Conventions

- **Tests:** `pnpm test <pattern>` (vitest, already configured).
- **Type-check:** `pnpm type-check` covers both renderer + main.
- **Commits:** small, focused. NO AI attribution per project commit policy. Husky + lint-staged auto-formats staged files on commit.
- **Branch:** `feature/side-by-side-panes` (already checked out).

---

### Task 1: Add `Pane` shared type

**Files:**

- Modify: `src/shared/types.ts` (append at the bottom)

- [ ] **Step 1: Append the new type to `src/shared/types.ts`**

```ts
// ── Terminal Panes ──────────────────────────────────────────

/**
 * One terminal pane in the multi-pane terminal area.
 *
 * `task` panes are bound to a task — they reuse the task's id as the PTY
 * session id, run in the task's worktree, and surface in the file changes /
 * diff UI as the focused task.
 *
 * `scratch` panes are ad-hoc Claude sessions detached from any task. They
 * have a synthetic id (`scratch-${uuid}`) and a user-chosen cwd (defaults
 * to ~/Documents). They never appear in the sidebar or DB.
 */
export type Pane = { kind: 'task'; taskId: string } | { kind: 'scratch'; id: string; cwd: string };
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: passes (pure additive change).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "Add Pane shared type for multi-pane terminal area"
```

---

### Task 2: Pure helpers for panes (TDD)

This task is the foundation — everything else builds on these helpers. Strict TDD: tests first, see them fail, implement, see them pass.

**Files:**

- Create: `src/renderer/panes/derived.ts`
- Create: `src/renderer/panes/__tests__/derived.test.ts`

- [ ] **Step 1: Write the failing tests at `src/renderer/panes/__tests__/derived.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  derivedActiveTaskId,
  generateScratchId,
  loadPanesFromStorage,
  savePanesToStorage,
} from '../derived';
import type { Pane } from '../../../shared/types';

describe('derivedActiveTaskId', () => {
  it('returns the task id when the focused pane is a task pane', () => {
    const panes: Pane[] = [{ kind: 'task', taskId: 't-1' }];
    expect(derivedActiveTaskId(panes, 0)).toBe('t-1');
  });

  it('returns null when the focused pane is a scratch pane', () => {
    const panes: Pane[] = [{ kind: 'scratch', id: 'scratch-1', cwd: '/home/me' }];
    expect(derivedActiveTaskId(panes, 0)).toBeNull();
  });

  it('returns null for an out-of-range focus index', () => {
    const panes: Pane[] = [{ kind: 'task', taskId: 't-1' }];
    expect(derivedActiveTaskId(panes, 5)).toBeNull();
    expect(derivedActiveTaskId(panes, -1)).toBeNull();
  });

  it('returns null for an empty panes list', () => {
    expect(derivedActiveTaskId([], 0)).toBeNull();
  });

  it('uses the focused pane (not the first one) for the lookup', () => {
    const panes: Pane[] = [
      { kind: 'task', taskId: 't-a' },
      { kind: 'task', taskId: 't-b' },
    ];
    expect(derivedActiveTaskId(panes, 1)).toBe('t-b');
  });
});

describe('generateScratchId', () => {
  it('returns an id starting with the scratch- prefix', () => {
    expect(generateScratchId()).toMatch(/^scratch-/);
  });

  it('returns a unique id on each call', () => {
    const ids = new Set([generateScratchId(), generateScratchId(), generateScratchId()]);
    expect(ids.size).toBe(3);
  });
});

describe('localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips panes through localStorage', () => {
    const panes: Pane[] = [
      { kind: 'task', taskId: 't-1' },
      { kind: 'scratch', id: 'scratch-abc', cwd: '/home/me/Documents' },
    ];
    savePanesToStorage(panes, 1);
    const loaded = loadPanesFromStorage();
    expect(loaded.panes).toEqual(panes);
    expect(loaded.focusedIndex).toBe(1);
  });

  it('returns empty defaults when nothing is saved', () => {
    const loaded = loadPanesFromStorage();
    expect(loaded.panes).toEqual([]);
    expect(loaded.focusedIndex).toBe(0);
  });

  it('clamps a saved focused index that is now out of range', () => {
    const panes: Pane[] = [{ kind: 'task', taskId: 't-1' }];
    savePanesToStorage(panes, 5);
    const loaded = loadPanesFromStorage();
    expect(loaded.focusedIndex).toBe(0);
  });

  it('returns empty defaults when the saved JSON is corrupt', () => {
    localStorage.setItem('panes', '{this is not json');
    const loaded = loadPanesFromStorage();
    expect(loaded.panes).toEqual([]);
    expect(loaded.focusedIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test panes/derived`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/panes/derived.ts`**

```ts
import type { Pane } from '../../shared/types';

const PANES_KEY = 'panes';
const FOCUSED_INDEX_KEY = 'focusedPaneIndex';

/**
 * Returns the focused pane's `taskId` when it is a task pane; otherwise null.
 * `null` matches the existing "no task selected" idle state used throughout
 * the renderer, so downstream consumers (diff modal, file changes panel)
 * don't need any special handling for scratch panes.
 */
export function derivedActiveTaskId(panes: Pane[], focusedIndex: number): string | null {
  if (focusedIndex < 0 || focusedIndex >= panes.length) return null;
  const pane = panes[focusedIndex];
  return pane.kind === 'task' ? pane.taskId : null;
}

/** Generate a unique synthetic id for a scratch pane. */
export function generateScratchId(): string {
  // crypto.randomUUID is available in Electron's renderer (Chromium); falls
  // back to a timestamp + random for any context that doesn't have it.
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `scratch-${uuid}`;
}

interface LoadedPanes {
  panes: Pane[];
  focusedIndex: number;
}

/** Read the panes layout from localStorage. Returns empty defaults on miss or corruption. */
export function loadPanesFromStorage(): LoadedPanes {
  try {
    const raw = localStorage.getItem(PANES_KEY);
    if (!raw) return { panes: [], focusedIndex: 0 };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { panes: [], focusedIndex: 0 };
    const panes = parsed.filter(isPane);
    const rawFocused = Number(localStorage.getItem(FOCUSED_INDEX_KEY) ?? 0);
    const focusedIndex =
      Number.isFinite(rawFocused) && rawFocused >= 0 && rawFocused < panes.length
        ? Math.floor(rawFocused)
        : 0;
    return { panes, focusedIndex };
  } catch {
    return { panes: [], focusedIndex: 0 };
  }
}

/** Persist the panes layout to localStorage. */
export function savePanesToStorage(panes: Pane[], focusedIndex: number): void {
  localStorage.setItem(PANES_KEY, JSON.stringify(panes));
  localStorage.setItem(FOCUSED_INDEX_KEY, String(focusedIndex));
}

/**
 * Default cwd for new scratch panes. The renderer doesn't have direct fs
 * access, so we ask the main process for the user's home directory and
 * append `Documents`. If `~/Documents` doesn't exist on disk the PTY layer
 * still tries to spawn there; node-pty will surface a spawn error which the
 * existing TerminalPane overlay handles.
 */
export async function defaultScratchCwd(): Promise<string> {
  // The main process exposes home dir via `getPlatform`-adjacent IPC; we
  // synthesize the path via `path.join`-equivalent string concatenation in
  // the renderer. See preload.ts: `getHomeDir`.
  const home = await window.electronAPI.getHomeDir();
  return `${home}/Documents`;
}

function isPane(value: unknown): value is Pane {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'task' && typeof v.taskId === 'string') return true;
  if (v.kind === 'scratch' && typeof v.id === 'string' && typeof v.cwd === 'string') return true;
  return false;
}
```

- [ ] **Step 4: Add the `getHomeDir` IPC needed by `defaultScratchCwd`**

The renderer can't call Node `os.homedir()` directly. Add a small read-only IPC.

In `src/main/ipc/appIpc.ts`, find the existing `app:openExternal` block and append below it (inside `registerAppIpc()`):

```ts
ipcMain.handle('app:getHomeDir', () => {
  return { success: true, data: homedir() };
});
```

`homedir` is already imported at the top of the file (`import { homedir } from 'os';`). Verify with: `grep -n "homedir" src/main/ipc/appIpc.ts`

In `src/main/preload.ts`, in the `// Dialogs` block, add:

```ts
getHomeDir: () => ipcRenderer.invoke('app:getHomeDir'),
```

Place it next to `openExternal`.

In `src/types/electron-api.d.ts`, in the `ElectronAPI` interface, add:

```ts
getHomeDir: () => Promise<IpcResponse<string>>;
```

Place it near the other `app:*` methods (e.g. right before `showOpenDialog`).

But the `defaultScratchCwd` helper above expects `getHomeDir` to return a plain string, not an `IpcResponse<string>`. Update the helper to unwrap:

```ts
export async function defaultScratchCwd(): Promise<string> {
  const res = await window.electronAPI.getHomeDir();
  const home = res.success && res.data ? res.data : '/tmp';
  return `${home}/Documents`;
}
```

(The `/tmp` fallback is for the unreachable case where the IPC fails — better than throwing.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test panes/derived`
Expected: 11/11 pass.

The `defaultScratchCwd` helper is not tested here because it requires mocking the electronAPI; it's exercised at the integration level when a scratch pane is created.

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/panes/ src/main/ipc/appIpc.ts src/main/preload.ts src/types/electron-api.d.ts
git commit -m "Add pure helpers for terminal panes + getHomeDir IPC"
```

---

### Task 3: `PaneShell` component

A single pane: header strip (label + close ×) + the existing `<TerminalPane>`. Pure presentation; receives all state via props.

**Files:**

- Create: `src/renderer/components/PaneShell.tsx`

- [ ] **Step 1: Create `src/renderer/components/PaneShell.tsx`**

```tsx
import React from 'react';
import { X, Terminal as TerminalIcon } from 'lucide-react';
import { TerminalPane } from './TerminalPane';
import type { Pane } from '../../shared/types';
import type { Task } from '../../shared/types';

export interface PaneShellProps {
  pane: Pane;
  /** Looked up from the tasks list so we can show the task name on a `task` pane. */
  task: Task | null;
  isFocused: boolean;
  /** Whether to show the close button (false on the last remaining pane). */
  canClose: boolean;
  onFocus: () => void;
  onClose: () => void;
}

export function PaneShell({ pane, task, isFocused, canClose, onFocus, onClose }: PaneShellProps) {
  const label = pane.kind === 'task' ? (task?.name ?? 'Task') : `scratch · ${basename(pane.cwd)}`;

  const id = pane.kind === 'task' ? pane.taskId : pane.id;
  const cwd = pane.kind === 'task' ? (task?.path ?? '') : pane.cwd;
  const autoApprove = pane.kind === 'task' ? (task?.autoApprove ?? false) : false;

  return (
    <div
      className={[
        'h-full w-full flex flex-col bg-background',
        isFocused ? 'ring-1 ring-inset ring-primary/30' : '',
      ].join(' ')}
      onMouseDown={onFocus}
    >
      <div
        className="flex items-center gap-2 px-3 h-8 flex-shrink-0 border-b border-border/60 text-[12px]"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <TerminalIcon
          size={12}
          strokeWidth={1.8}
          className="text-muted-foreground/60 flex-shrink-0"
        />
        <span className="truncate flex-1 min-w-0 text-foreground/90">{label}</span>
        {canClose && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Close pane"
            className="p-1 rounded-md hover:bg-accent text-muted-foreground/60 hover:text-foreground transition-colors flex-shrink-0"
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* The pane is unusable if a task pane lost its task. Render an empty
          state rather than mounting TerminalPane with empty cwd. */}
      {cwd ? (
        <div className="flex-1 min-h-0">
          <TerminalPane id={id} cwd={cwd} autoApprove={autoApprove} />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground/70">
          Task no longer available — close this pane.
        </div>
      )}
    </div>
  );
}

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/PaneShell.tsx
git commit -m "Add PaneShell component for single terminal pane chrome"
```

---

### Task 4: `TerminalPaneGroup` component

The horizontal `PanelGroup` that holds N `PaneShell`s plus the trailing `+` button.

**Files:**

- Create: `src/renderer/components/TerminalPaneGroup.tsx`

- [ ] **Step 1: Create `src/renderer/components/TerminalPaneGroup.tsx`**

```tsx
import React from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Plus } from 'lucide-react';
import { PaneShell } from './PaneShell';
import type { Pane, Task } from '../../shared/types';

export interface TerminalPaneGroupProps {
  panes: Pane[];
  focusedPaneIndex: number;
  /** Tasks indexed by id — used to look up task name + cwd for `task` panes. */
  taskById: Record<string, Task>;
  onFocus: (index: number) => void;
  onClose: (index: number) => void;
  onAdd: () => void;
}

export function TerminalPaneGroup({
  panes,
  focusedPaneIndex,
  taskById,
  onFocus,
  onClose,
  onAdd,
}: TerminalPaneGroupProps) {
  return (
    <div className="h-full w-full flex">
      <div className="flex-1 min-w-0 h-full">
        <PanelGroup direction="horizontal" id="terminal-pane-group">
          {panes.map((pane, i) => {
            const id = pane.kind === 'task' ? pane.taskId : pane.id;
            const task = pane.kind === 'task' ? (taskById[pane.taskId] ?? null) : null;
            return (
              <React.Fragment key={id}>
                {i > 0 && <PanelResizeHandle className="w-[1px] bg-border/40" />}
                <Panel minSize={15} order={i}>
                  <PaneShell
                    pane={pane}
                    task={task}
                    isFocused={i === focusedPaneIndex}
                    canClose={panes.length > 1}
                    onFocus={() => onFocus(i)}
                    onClose={() => onClose(i)}
                  />
                </Panel>
              </React.Fragment>
            );
          })}
        </PanelGroup>
      </div>

      {/* + button — fixed-width column on the right edge of the pane row. */}
      <button
        type="button"
        onClick={onAdd}
        title="New scratch terminal"
        className="w-8 flex items-center justify-center border-l border-border/60 hover:bg-accent text-muted-foreground/60 hover:text-foreground transition-colors flex-shrink-0"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <Plus size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/TerminalPaneGroup.tsx
git commit -m "Add TerminalPaneGroup for horizontal pane layout"
```

---

### Task 5: Wire pane state into `App.tsx`

This is the integration step: replace the single `activeTaskId` source-of-truth with `panes` + `focusedPaneIndex`, derive `activeTaskId` from those, persist to localStorage, build a `taskById` map, and pass everything down to `MainContent`.

**Files:**

- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add the new state and helpers near the top of `App` body**

Find the existing `const [activeTaskId, setActiveTaskId] = useState<string | null>(...)` declaration (around line 54). It will be REPLACED by derived state. First, add new pane state ABOVE it:

```tsx
import {
  derivedActiveTaskId,
  generateScratchId,
  loadPanesFromStorage,
  savePanesToStorage,
  defaultScratchCwd,
} from './panes/derived';
```

Add this import alongside the existing `./components/...` imports at the top of the file.

Inside the `App` component body, just below the `activeProjectId` state, add:

```tsx
const [panes, setPanes] = useState<Pane[]>(() => loadPanesFromStorage().panes);
const [focusedPaneIndex, setFocusedPaneIndex] = useState<number>(
  () => loadPanesFromStorage().focusedIndex,
);
```

Add `Pane` to the existing `import type { Project, Task, ... } from '../shared/types';` block.

- [ ] **Step 2: Replace the existing `activeTaskId` state with a derived value**

Find:

```tsx
const [activeTaskId, setActiveTaskId] = useState<string | null>(() =>
  localStorage.getItem('activeTaskId'),
);
```

REPLACE with:

```tsx
const activeTaskId = derivedActiveTaskId(panes, focusedPaneIndex);

// Wrapper that callers use as if it were the old setActiveTaskId. It either
// focuses an existing pane that already shows the task, or replaces the
// focused pane (when the focused pane is a task pane) — never grows pane
// count. Sidebar clicks and keyboard shortcuts both go through this.
const setActiveTaskId = useCallback(
  (taskId: string | null) => {
    if (taskId === null) return; // there's always at least one pane; no-op
    setPanes((prev) => {
      const existing = prev.findIndex((p) => p.kind === 'task' && p.taskId === taskId);
      if (existing !== -1) {
        setFocusedPaneIndex(existing);
        return prev;
      }
      // Replace the focused pane if it's a task pane; otherwise append.
      setFocusedPaneIndex((idx) => idx);
      const next = [...prev];
      const focused = next[focusedPaneIndex];
      if (focused && focused.kind === 'task') {
        next[focusedPaneIndex] = { kind: 'task', taskId };
      } else {
        next.push({ kind: 'task', taskId });
        setFocusedPaneIndex(next.length - 1);
      }
      return next;
    });
  },
  [focusedPaneIndex],
);
```

- [ ] **Step 3: Migrate the legacy `activeTaskId` localStorage entry**

Add this `useEffect` near the other localStorage-restore effects (search for `localStorage.getItem('activeTaskId')` originally). The effect runs once on mount and bootstraps panes from the legacy single-task setting if no panes were saved yet:

```tsx
useEffect(() => {
  if (panes.length > 0) return;
  const legacyTaskId = localStorage.getItem('activeTaskId');
  if (legacyTaskId) {
    setPanes([{ kind: 'task', taskId: legacyTaskId }]);
    setFocusedPaneIndex(0);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

This way existing users keep their last-active task as their first pane. Once panes are saved via the next effect, the legacy key is no longer authoritative.

- [ ] **Step 4: Persist panes + focused index whenever they change**

Add this effect near the top of the App body (after the state declarations):

```tsx
useEffect(() => {
  savePanesToStorage(panes, focusedPaneIndex);
}, [panes, focusedPaneIndex]);
```

- [ ] **Step 5: Drop saved task panes that point at deleted tasks**

When the projects/tasks list reloads, prune panes whose tasks no longer exist. Add this after the existing tasks-loading effects (search for `setTasksByProject`):

```tsx
useEffect(() => {
  const allTaskIds = new Set(
    Object.values(tasksByProject)
      .flat()
      .map((t) => t.id),
  );
  setPanes((prev) => {
    const filtered = prev.filter((p) => p.kind !== 'task' || allTaskIds.has(p.taskId));
    return filtered.length === prev.length ? prev : filtered;
  });
}, [tasksByProject]);
```

After pruning, if `focusedPaneIndex >= panes.length`, clamp it. Add immediately below the effect above:

```tsx
useEffect(() => {
  if (panes.length > 0 && focusedPaneIndex >= panes.length) {
    setFocusedPaneIndex(panes.length - 1);
  }
}, [panes.length, focusedPaneIndex]);
```

- [ ] **Step 6: Build a `taskById` map for fast pane lookup**

Add a memo near the existing `activeTask` memo (search for `// Find activeTask across all projects`):

```tsx
const taskById = useMemo(() => {
  const map: Record<string, Task> = {};
  for (const list of Object.values(tasksByProject)) {
    for (const task of list) map[task.id] = task;
  }
  return map;
}, [tasksByProject]);
```

- [ ] **Step 7: Add the pane action handlers**

Place these in the App body alongside existing handlers (e.g. near `handleViewDiff`):

```tsx
const handleFocusPane = useCallback((index: number) => {
  setFocusedPaneIndex(index);
}, []);

const handleClosePane = useCallback((index: number) => {
  setPanes((prev) => {
    if (prev.length <= 1) return prev; // never close the last pane
    const next = prev.filter((_, i) => i !== index);
    setFocusedPaneIndex((idx) => {
      if (idx === index) return Math.min(idx, next.length - 1);
      if (idx > index) return idx - 1;
      return idx;
    });
    return next;
  });
}, []);

const handleAddScratchPane = useCallback(async () => {
  const cwd = await defaultScratchCwd();
  setPanes((prev) => {
    const newPane: Pane = { kind: 'scratch', id: generateScratchId(), cwd };
    setFocusedPaneIndex(prev.length); // focus the new pane
    return [...prev, newPane];
  });
}, []);
```

- [ ] **Step 8: Pass pane props into `MainContent`**

Find the existing `<MainContent ...>` render (around line 1376). Add these props:

```tsx
<MainContent
  // ... existing props
  panes={panes}
  focusedPaneIndex={focusedPaneIndex}
  taskById={taskById}
  onFocusPane={handleFocusPane}
  onClosePane={handleClosePane}
  onAddScratchPane={handleAddScratchPane}
/>
```

- [ ] **Step 9: Type-check**

Run: `pnpm type-check`
Expected: passes. There may be props errors on `<MainContent>` that surface here; they're fixed in Task 6 below. If so, defer the commit to after Task 6.

- [ ] **Step 10: Commit (defer if Task 6 needs to land first)**

```bash
git add src/renderer/App.tsx
git commit -m "Drive activeTaskId from panes state in App.tsx"
```

---

### Task 6: Render `<TerminalPaneGroup>` from `MainContent`

The final integration step: `MainContent` stops rendering `<TerminalPane>` directly and starts rendering `<TerminalPaneGroup>` with the props threaded from App.

**Files:**

- Modify: `src/renderer/components/MainContent.tsx`

- [ ] **Step 1: Add the new props to the `MainContent` props interface**

Find the existing `MainContent` props interface (search `interface MainContentProps`). Add:

```ts
panes: Pane[];
focusedPaneIndex: number;
taskById: Record<string, Task>;
onFocusPane: (index: number) => void;
onClosePane: (index: number) => void;
onAddScratchPane: () => void;
```

Add `Pane` to the imports at the top of the file:

```ts
import type { Pane, Task } from '../../shared/types';
```

(`Task` may already be imported.)

- [ ] **Step 2: Destructure the new props**

In the `MainContent({...})` parameter destructure, add:

```ts
panes,
focusedPaneIndex,
taskById,
onFocusPane,
onClosePane,
onAddScratchPane,
```

- [ ] **Step 3: Replace the `<TerminalPane>` mount with `<TerminalPaneGroup>`**

Find this block (around line 339):

```tsx
<div className="flex-1 min-h-0">
  <TerminalPane
    key={activeTask.id}
    id={activeTask.id}
    cwd={activeTask.path}
    autoApprove={activeTask.autoApprove}
  />
</div>
```

REPLACE with:

```tsx
<div className="flex-1 min-h-0">
  <TerminalPaneGroup
    panes={panes}
    focusedPaneIndex={focusedPaneIndex}
    taskById={taskById}
    onFocus={onFocusPane}
    onClose={onClosePane}
    onAdd={onAddScratchPane}
  />
</div>
```

Update the import at the top of the file:

```ts
import { TerminalPaneGroup } from './TerminalPaneGroup';
```

You can leave the existing `import { TerminalPane }` line in place if it's still used elsewhere in the file (it isn't — but the linter will catch it).

- [ ] **Step 4: Remove the `if (!activeTask) return ...` guard around the terminal**

Search inside `MainContent.tsx` for the early-return guard that bails when there's no `activeTask`. The terminal area should now always render `<TerminalPaneGroup>` (which itself shows an empty state when `panes.length === 0`). Keep the empty-state render that shows when there are no projects, but allow the panes group to mount even when `activeTask` is null.

If the existing structure has multiple early returns, the safest minimal change is: only short-circuit when `activeProject` is missing. When project exists but no active task, fall through to render the task header + `<TerminalPaneGroup>`.

- [ ] **Step 5: Handle the empty-panes case in `TerminalPaneGroup`**

Open `src/renderer/components/TerminalPaneGroup.tsx` and add an early return at the top of the component body:

```tsx
if (panes.length === 0) {
  return (
    <div className="h-full w-full flex items-center justify-center text-[12px] text-muted-foreground/70">
      Select a task or click + to open a scratch terminal.
    </div>
  );
}
```

(Yes, the empty state has the `+` button referenced by name even though it's not rendered when panes are empty. Add the `+` button outside the empty branch — change the JSX so the `+` always renders, only the panel group is gated on `panes.length > 0`.)

Final `TerminalPaneGroup` JSX after this change:

```tsx
return (
  <div className="h-full w-full flex">
    <div className="flex-1 min-w-0 h-full">
      {panes.length === 0 ? (
        <div className="h-full w-full flex items-center justify-center text-[12px] text-muted-foreground/70">
          Select a task or click + to open a scratch terminal.
        </div>
      ) : (
        <PanelGroup direction="horizontal" id="terminal-pane-group">
          {/* … existing pane render … */}
        </PanelGroup>
      )}
    </div>
    <button /* + button, unchanged */ />
  </div>
);
```

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 7: Run all tests**

Run: `pnpm test`
Expected: 11 passing for `panes/derived` + the existing suite count, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/MainContent.tsx src/renderer/components/TerminalPaneGroup.tsx
git commit -m "Render TerminalPaneGroup in MainContent"
```

If Task 5's commit was deferred, fold it in here:

```bash
git add src/renderer/App.tsx
git commit -m "Drive activeTaskId from panes state in App.tsx"
```

(Two separate commits — they're separable concerns.)

---

### Task 7: Manual smoke test

Pure validation step. No code changes.

- [ ] **Step 1: Restart `pnpm dev`**

Main process changed (Task 2 added `app:getHomeDir` IPC), so a hot reload of just the renderer isn't enough. Stop and restart:

```
# In the dev terminal: Ctrl+C
pnpm dev
```

- [ ] **Step 2: Verify single-pane behavior is unchanged**

In the running app, click around as before. Expected:

- Existing task selected by sidebar → renders one terminal pane that fills the column.
- Diff modal still opens for files in the changes panel.
- Closing/restarting the app preserves the active task (now stored as a single task pane).

- [ ] **Step 3: Verify pane add**

Click the `+` button at the right edge of the terminal column.

- A new pane appears next to the existing one.
- Header shows `scratch · Documents`.
- A fresh Claude Code session spawns inside.
- Activity dots / status line work for both panes independently.

- [ ] **Step 4: Verify pane focus**

Click inside the right pane. Expected:

- The right pane's header gets the highlighted ring.
- The file changes panel goes empty (because focus is now a scratch pane → activeTaskId=null).
- Clicking back into the left pane restores the file changes panel for that task.

- [ ] **Step 5: Verify pane close**

Click `×` on the scratch pane. Expected:

- Pane disappears.
- Focus returns to the task pane.
- File changes panel reflects the task again.

- [ ] **Step 6: Verify persistence**

Open a scratch pane. Force quit the app (Cmd+Q). Reopen.

- The pane layout returns: task pane + scratch pane.
- The scratch terminal restarts in `~/Documents` (no transcript carryover, expected — it's a fresh Claude every spawn).

- [ ] **Step 7: Verify diff focus interaction**

With two panes open and the task pane focused, click a file in the changes panel. The diff opens in focus mode. Both panes (and the rest of the chrome) hide as today; on close, both reappear.

- [ ] **Step 8: No commit needed**

Manual test — nothing to add to git.

---

## Self-Review Checklist (post-implementation)

Run through these once before declaring done:

- `pnpm type-check` clean.
- `pnpm test` clean — `panes/derived` tests pass; existing tests unaffected.
- Manual: smoke test from Task 7 passes end-to-end.
- No leftover `import { TerminalPane }` in `MainContent.tsx` if it's no longer used.
- Legacy `localStorage.getItem('activeTaskId')` is read once on bootstrap (Task 5 step 3); not removed entirely so existing users get a soft migration.
- No `console.log` debug noise in any of the new files.
- New `Pane` type used consistently — no `any` shortcuts.
