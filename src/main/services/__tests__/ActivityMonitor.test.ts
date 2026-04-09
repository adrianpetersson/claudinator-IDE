import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process and electron
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('util', () => ({
  promisify: () => vi.fn().mockResolvedValue({ stdout: '' }),
}));
vi.mock('electron', () => ({
  default: {},
}));

import { activityMonitor } from '../ActivityMonitor';

describe('ActivityMonitor', () => {
  const mockSender = {
    send: vi.fn(),
    isDestroyed: () => false,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // Start with a mock sender but don't start polling (we test state transitions directly)
    (activityMonitor as any).sender = mockSender;
  });

  afterEach(() => {
    // Clean up all registered PTYs
    const activities = (activityMonitor as any).activities as Map<string, any>;
    for (const id of activities.keys()) {
      activityMonitor.unregister(id);
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('state transitions', () => {
    it('registers a PTY in idle state', () => {
      activityMonitor.register('pty1', 12345, true);
      const all = activityMonitor.getAll();
      expect(all['pty1'].state).toBe('idle');
    });

    it('transitions idle → busy on setBusy', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setBusy('pty1');
      expect(activityMonitor.getAll()['pty1'].state).toBe('busy');
    });

    it('transitions busy → idle on setIdle', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setBusy('pty1');
      activityMonitor.setIdle('pty1');
      expect(activityMonitor.getAll()['pty1'].state).toBe('idle');
    });

    it('transitions to waiting on setWaitingForPermission', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setBusy('pty1');
      activityMonitor.setWaitingForPermission('pty1');
      expect(activityMonitor.getAll()['pty1'].state).toBe('waiting');
    });

    it('transitions to error on setError', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setBusy('pty1');
      activityMonitor.setError('pty1', 'rate_limit', 'Rate limited');
      const info = activityMonitor.getAll()['pty1'];
      expect(info.state).toBe('error');
      expect(info.error?.type).toBe('rate_limit');
      expect(info.error?.message).toBe('Rate limited');
    });

    it('maps error types correctly', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setError('pty1', 'authentication_failed');
      expect(activityMonitor.getAll()['pty1'].error?.type).toBe('auth_error');

      activityMonitor.setError('pty1', 'billing_error');
      expect(activityMonitor.getAll()['pty1'].error?.type).toBe('billing_error');

      activityMonitor.setError('pty1', 'something_else');
      expect(activityMonitor.getAll()['pty1'].error?.type).toBe('unknown');
    });

    it('clears error on setBusy', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setError('pty1', 'rate_limit');
      activityMonitor.setBusy('pty1');
      const info = activityMonitor.getAll()['pty1'];
      expect(info.state).toBe('busy');
      expect(info.error).toBeUndefined();
    });

    it('does not re-idle an already idle PTY', () => {
      activityMonitor.register('pty1', 12345, true);
      const callsBefore = mockSender.send.mock.calls.length;
      activityMonitor.setIdle('pty1'); // already idle
      // Should not emit again since state didn't change
      expect(mockSender.send.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('tool tracking', () => {
    it('sets tool on setToolStart', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setToolStart('pty1', 'Bash', { command: 'ls -la' });
      const info = activityMonitor.getAll()['pty1'];
      expect(info.tool?.toolName).toBe('Bash');
      expect(info.tool?.label).toBe('ls -la');
      expect(info.state).toBe('busy');
    });

    it('clears tool on setToolEnd', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setToolStart('pty1', 'Bash', { command: 'ls' });
      activityMonitor.setToolEnd('pty1');
      expect(activityMonitor.getAll()['pty1'].tool).toBeUndefined();
    });

    it('clears tool on setIdle', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setToolStart('pty1', 'Read', { file_path: '/foo/bar.ts' });
      activityMonitor.setIdle('pty1');
      expect(activityMonitor.getAll()['pty1'].tool).toBeUndefined();
    });
  });

  describe('compacting', () => {
    it('sets and clears compacting state', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setBusy('pty1');
      activityMonitor.setCompacting('pty1', true);
      expect(activityMonitor.getAll()['pty1'].compacting).toBe(true);

      activityMonitor.setCompacting('pty1', false);
      expect(activityMonitor.getAll()['pty1'].compacting).toBeUndefined();
    });

    it('clears tool when compacting starts', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setToolStart('pty1', 'Bash', { command: 'ls' });
      activityMonitor.setCompacting('pty1', true);
      expect(activityMonitor.getAll()['pty1'].tool).toBeUndefined();
    });
  });

  describe('noteStatusLine', () => {
    it('does not transition idle → busy within IDLE_SETTLE_MS', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setBusy('pty1');
      activityMonitor.setIdle('pty1');
      // Immediately after setIdle, noteStatusLine should NOT flip back to busy
      activityMonitor.noteStatusLine('pty1');
      expect(activityMonitor.getAll()['pty1'].state).toBe('idle');
    });

    it('transitions idle → busy after IDLE_SETTLE_MS', () => {
      activityMonitor.register('pty1', 12345, true);
      activityMonitor.setBusy('pty1');
      activityMonitor.setIdle('pty1');
      // Advance past IDLE_SETTLE_MS (2000ms)
      vi.advanceTimersByTime(2100);
      activityMonitor.noteStatusLine('pty1');
      expect(activityMonitor.getAll()['pty1'].state).toBe('busy');
    });
  });

  describe('shell PTYs are not exposed', () => {
    it('filters out non-direct-spawn PTYs from getAll', () => {
      activityMonitor.register('shell1', 12345, false);
      activityMonitor.register('claude1', 12346, true);
      const all = activityMonitor.getAll();
      expect(all['shell1']).toBeUndefined();
      expect(all['claude1']).toBeDefined();
    });
  });
});
