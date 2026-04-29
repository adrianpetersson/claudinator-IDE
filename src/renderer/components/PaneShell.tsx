import React from 'react';
import { X, Terminal as TerminalIcon } from 'lucide-react';
import { TerminalPane } from './TerminalPane';
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
}

export function PaneShell({ pane, task, isFocused, canClose, onFocus, onClose }: PaneShellProps) {
  const label = pane.kind === 'task' ? (task?.name ?? 'Task') : `scratch · ${basename(pane.cwd)}`;

  const id = pane.kind === 'task' ? pane.taskId : pane.id;
  const cwd = pane.kind === 'task' ? (task?.path ?? '') : pane.cwd;
  const autoApprove = pane.kind === 'task' ? (task?.autoApprove ?? false) : false;
  // Scratch panes get a colored, renamed identity so they're visually distinct
  // from task panes. Sent via Claude slash commands once the session is ready.
  const initialCommands = pane.kind === 'scratch' ? ['/rename scratch', '/color green'] : undefined;

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
          <TerminalPane
            id={id}
            cwd={cwd}
            autoApprove={autoApprove}
            initialCommands={initialCommands}
          />
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
