import React from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { PaneShell } from './PaneShell';
import type { Pane, Task } from '../../shared/types';

export interface TerminalPaneGroupProps {
  panes: Pane[];
  focusedPaneIndex: number;
  /** Tasks indexed by id — used to look up task name + cwd for `task` panes. */
  taskById: Record<string, Task>;
  onFocus: (index: number) => void;
  onClose: (index: number) => void;
}

export function TerminalPaneGroup({
  panes,
  focusedPaneIndex,
  taskById,
  onFocus,
  onClose,
}: TerminalPaneGroupProps) {
  if (panes.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-[12px] text-muted-foreground/70">
        Select a task or click + to open a scratch terminal.
      </div>
    );
  }

  return (
    <PanelGroup direction="horizontal" id="terminal-pane-group">
      {panes.map((pane, i) => {
        const id =
          pane.kind === 'task'
            ? pane.taskId
            : pane.kind === 'file'
              ? `${pane.taskId}:${pane.filePath}`
              : pane.id;
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
  );
}
