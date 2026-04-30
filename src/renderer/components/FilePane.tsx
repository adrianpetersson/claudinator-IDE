import React, { useEffect, useState } from 'react';
import { X, FileText, AlertTriangle } from 'lucide-react';
import { FileView } from './FileView';
import { IconButton } from './ui/IconButton';
import type { ReadFileResult } from '@shared/types';

interface FilePaneProps {
  taskId: string;
  /** Absolute worktree path — used by "Open in IDE" for too-large files. */
  cwd: string;
  filePath: string;
  onClose: () => void;
}

export function FilePane({ taskId, cwd, filePath, onClose }: FilePaneProps) {
  const [meta, setMeta] = useState<ReadFileResult | null>(null);
  const [stale, setStale] = useState(false);

  const reload = async () => {
    const res = await window.electronAPI.fileBrowserReadFile({ taskId, filePath });
    if (res.success) {
      setMeta(res.data ?? null);
      setStale(res.data?.kind === 'error' && res.data.reason === 'not_found');
    }
  };

  useEffect(() => {
    reload();
    const off = window.electronAPI.onFileBrowserFileChanged(taskId, (p) => {
      if (p === filePath) reload();
    });
    return off;
  }, [taskId, filePath]); // reload is stable per render; intentionally omitted

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--surface-0))]">
      <div className="flex items-center justify-between px-2 py-1 border-b border-[hsl(var(--border))] text-xs">
        <div className="flex items-center gap-1.5 truncate">
          <FileText className="w-3.5 h-3.5 stroke-[1.8] text-[hsl(var(--muted-foreground))]" />
          <span
            className={`truncate ${stale ? 'line-through text-[hsl(var(--muted-foreground))]' : ''}`}
          >
            {filePath}
          </span>
          {stale && (
            <span className="text-[hsl(var(--destructive))] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> deleted on disk
            </span>
          )}
        </div>
        <IconButton onClick={() => onClose()} title="Close file">
          <X className="w-3.5 h-3.5" />
        </IconButton>
      </div>
      <div className="flex-1 overflow-auto">
        {/* Editor seam: replace this body with Monaco/CodeMirror later */}
        {meta?.kind === 'text' && <FileView taskId={taskId} filePath={filePath} />}
        {meta?.kind === 'binary' && (
          <div className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
            Binary file — {(meta.bytes / 1024).toFixed(1)} KB
          </div>
        )}
        {meta?.kind === 'error' && meta.reason === 'too_large' && (
          <div className="p-4 text-xs text-[hsl(var(--muted-foreground))] space-y-2">
            <div>
              File too large to preview ({((meta.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB).
            </div>
            <button
              onClick={() => window.electronAPI.openInEditor({ cwd, filePath })}
              className="text-[hsl(var(--primary))] hover:underline"
            >
              Open in IDE
            </button>
          </div>
        )}
        {meta?.kind === 'error' && meta.reason === 'not_found' && (
          <div className="p-4 text-xs text-[hsl(var(--destructive))]">File not found.</div>
        )}
        {meta?.kind === 'error' && meta.reason === 'read_failed' && (
          <div className="p-4 text-xs text-[hsl(var(--destructive))] space-y-2">
            <div>Read failed: {meta.message}</div>
            <button onClick={reload} className="text-[hsl(var(--primary))] hover:underline">
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
