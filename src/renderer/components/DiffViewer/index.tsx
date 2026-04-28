import React, { useCallback, useRef, useState } from 'react';
import { X, FileText, Send } from 'lucide-react';
import type { DiffResult } from '../../../shared/types';
import { DiffPane, type DiffPaneCommentState } from './DiffPane';
import { MinimapRail } from './MinimapRail';

interface DiffViewerProps {
  diff: DiffResult | null;
  loading: boolean;
  activeTaskId: string | null;
  onClose: () => void;
}

export function DiffViewer({ diff, loading, activeTaskId, onClose }: DiffViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [commentState, setCommentState] = useState<DiffPaneCommentState>({
    count: 0,
    addToPrompt: () => {},
  });

  const handleCommentStateChange = useCallback((state: DiffPaneCommentState) => {
    setCommentState(state);
  }, []);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!diff && !loading) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[92vw] max-w-5xl h-[85vh] flex flex-col animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60 flex-shrink-0"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <FileText
              size={14}
              className="text-muted-foreground/50 flex-shrink-0"
              strokeWidth={1.8}
            />
            <span className="text-[13px] font-medium text-foreground truncate">
              {diff?.filePath || 'Loading...'}
            </span>
            {diff && !diff.isBinary && (diff.additions > 0 || diff.deletions > 0) && (
              <div className="flex gap-2 text-[11px] font-mono flex-shrink-0 tabular-nums">
                {diff.additions > 0 && (
                  <span className="text-[hsl(var(--git-added))]">+{diff.additions}</span>
                )}
                {diff.deletions > 0 && (
                  <span className="text-[hsl(var(--git-deleted))]">-{diff.deletions}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {commentState.count > 0 && (
              <button
                onClick={commentState.addToPrompt}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all duration-150 animate-fade-in"
              >
                <Send size={11} strokeWidth={2} />
                Add {commentState.count} comment{commentState.count !== 1 ? 's' : ''} to prompt
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={scrollContainerRef}
            className="h-full overflow-auto font-mono text-[12px] leading-[20px] relative"
          >
            {loading && (
              <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <span className="text-[13px] text-muted-foreground/50">Loading diff...</span>
                </div>
              </div>
            )}

            {diff && (
              <DiffPane
                diff={diff}
                activeTaskId={activeTaskId}
                scrollContainerRef={scrollContainerRef}
                onClose={onClose}
                onCommentStateChange={handleCommentStateChange}
              />
            )}
          </div>

          {/* Scrollbar change minimap */}
          {diff && !diff.isBinary && (
            <MinimapRail hunks={diff.hunks} scrollContainerRef={scrollContainerRef} />
          )}
        </div>
      </div>
    </div>
  );
}
