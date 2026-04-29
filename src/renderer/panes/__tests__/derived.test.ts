// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
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
