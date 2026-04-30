import React from 'react';
import { X, Terminal as TerminalIcon, Sparkles } from 'lucide-react';
import { TerminalPane } from './TerminalPane';
import { FilePane } from './FilePane';
import type { Pane, Task } from '../../shared/types';

export interface PaneShellProps {
  pane: Pane;
  /** Looked up from the tasks list so we can show the task name on a `task` pane. */
  task: Task | null;
  isFocused: boolean;
  /** Whether to show the close button (false on the last remaining pane). */
  canClose: boolean;
  onFocus: () => void;
  onClose: () => void;
  /** Absolute worktree path for the active task — passed to FilePane for IDE open. */
  taskCwd?: string | null;
}

export function PaneShell({
  pane,
  task,
  isFocused,
  canClose,
  onFocus,
  onClose,
  taskCwd,
}: PaneShellProps) {
  if (pane.kind === 'file') {
    return (
      <FilePane
        taskId={pane.taskId}
        cwd={taskCwd ?? ''}
        filePath={pane.filePath}
        onClose={onClose}
      />
    );
  }

  const isScratch = pane.kind === 'scratch';
  const id = isScratch ? pane.id : pane.taskId;
  const cwd = isScratch ? pane.cwd : (task?.path ?? '');
  const autoApprove = isScratch ? false : (task?.autoApprove ?? false);

  return (
    <div
      className={[
        'h-full w-full flex flex-col bg-background',
        isFocused ? 'ring-1 ring-inset ring-primary/30' : '',
      ].join(' ')}
      onMouseDown={onFocus}
    >
      <div
        className={[
          'flex items-center gap-2 px-3 h-8 flex-shrink-0 border-b text-[12px]',
          isScratch ? 'border-emerald-500/30' : 'border-border/60',
        ].join(' ')}
        style={{
          background: isScratch
            ? 'linear-gradient(to right, hsl(152 60% 35% / 0.18), hsl(var(--surface-1)) 30%)'
            : 'hsl(var(--surface-1))',
        }}
      >
        {isScratch ? (
          <Sparkles size={12} strokeWidth={1.8} className="text-emerald-400 flex-shrink-0" />
        ) : (
          <TerminalIcon
            size={12}
            strokeWidth={1.8}
            className="text-muted-foreground/60 flex-shrink-0"
          />
        )}
        <span className="truncate flex-1 min-w-0 text-foreground/90">
          {isScratch ? (
            <>
              <span className="text-emerald-400 font-medium">scratch</span>
              <span className="text-muted-foreground/60"> · {basename(pane.cwd)}</span>
            </>
          ) : (
            (task?.name ?? 'Task')
          )}
        </span>
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
