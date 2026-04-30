import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Eye, EyeOff } from 'lucide-react';
import type { TreeNode } from '@shared/types';

interface FileTreeProps {
  taskId: string | null;
  onOpenFile: (filePath: string) => void;
}

export function FileTree({ taskId, onOpenFile }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState<boolean>(
    () => localStorage.getItem('fileTree:showHidden') === '1',
  );

  const reload = useCallback(async () => {
    if (!taskId) {
      setTree([]);
      return;
    }
    const res = await window.electronAPI.fileBrowserListTree({ taskId, showHidden });
    if (res.success) setTree(res.data ?? []);
  }, [taskId, showHidden]);

  useEffect(() => {
    reload();
    if (!taskId) return;
    const off = window.electronAPI.onFileBrowserTreeChanged(taskId, () => {
      reload();
    });
    return off;
  }, [taskId, reload]);

  useEffect(() => {
    localStorage.setItem('fileTree:showHidden', showHidden ? '1' : '0');
  }, [showHidden]);

  const toggle = (p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  if (!taskId) {
    return (
      <div className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
        Select a task to browse files.
      </div>
    );
  }

  return (
    <div className="flex flex-col text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[hsl(var(--border))]">
        <span className="text-[hsl(var(--muted-foreground))] uppercase tracking-wide text-[10px]">
          Files
        </span>
        <button
          className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          onClick={() => setShowHidden((v) => !v)}
          title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
        >
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="overflow-auto py-1">
        {tree.map((n) => (
          <Node
            key={n.path}
            node={n}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}

function Node({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (filePath: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const indent = { paddingLeft: 4 + depth * 12 };

  if (node.kind === 'dir') {
    return (
      <>
        <div
          style={indent}
          onClick={() => onToggle(node.path)}
          className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-[hsl(var(--surface-1))]"
        >
          {isOpen ? (
            <ChevronDown className="w-3 h-3 stroke-[1.8]" />
          ) : (
            <ChevronRight className="w-3 h-3 stroke-[1.8]" />
          )}
          {isOpen ? (
            <FolderOpen className="w-3.5 h-3.5 stroke-[1.8]" />
          ) : (
            <Folder className="w-3.5 h-3.5 stroke-[1.8]" />
          )}
          <span>{node.name}</span>
        </div>
        {isOpen &&
          node.children?.map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
      </>
    );
  }

  return (
    <div
      style={indent}
      onClick={() => onOpenFile(node.path)}
      className="flex items-center gap-1 py-0.5 pl-4 cursor-pointer hover:bg-[hsl(var(--surface-1))]"
    >
      <FileText className="w-3.5 h-3.5 stroke-[1.8] text-[hsl(var(--muted-foreground))]" />
      <span>{node.name}</span>
    </div>
  );
}
