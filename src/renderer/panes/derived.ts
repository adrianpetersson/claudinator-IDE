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
 * Default cwd for new scratch panes. Asks the main process for the user's
 * home directory and appends `Documents`. If the IPC fails, falls back to
 * `/tmp` so we don't throw — the spawn will surface its own error in the
 * terminal overlay.
 */
export async function defaultScratchCwd(): Promise<string> {
  const res = await window.electronAPI.getHomeDir();
  const home = res.success && res.data ? res.data : '/tmp';
  return `${home}/Documents`;
}

function isPane(value: unknown): value is Pane {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'task' && typeof v.taskId === 'string') return true;
  if (v.kind === 'scratch' && typeof v.id === 'string' && typeof v.cwd === 'string') return true;
  return false;
}
