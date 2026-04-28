import React, { useState } from 'react';
import type { ReasoningTurn } from '../../../shared/types';

const COLLAPSED_LINES = 3;

export interface ReasoningSidebarProps {
  /** Turns that mapped to at least one hunk. Rendered first, in turn order. */
  mappedTurns: ReasoningTurn[];
  /** Turns that couldn't be located. Rendered last with a subtle "(location not found)" note. */
  unmappedTurns: ReasoningTurn[];
  activeTurnIndex: number | null;
  onTurnClick: (turnIndex: number) => void;
  loading?: boolean;
}

export function ReasoningSidebar({
  mappedTurns,
  unmappedTurns,
  activeTurnIndex,
  onTurnClick,
  loading,
}: ReasoningSidebarProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const allTurns = [...mappedTurns, ...unmappedTurns];

  const toggleExpand = (turnIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(turnIndex)) next.delete(turnIndex);
      else next.add(turnIndex);
      return next;
    });
  };

  if (loading) {
    return (
      <aside className="w-[280px] flex-shrink-0 border-l border-border/60 bg-[hsl(var(--surface-1))] px-3 py-3 text-[11px] text-muted-foreground/70">
        Loading reasoning…
      </aside>
    );
  }

  if (allTurns.length === 0) {
    return (
      <aside className="w-[280px] flex-shrink-0 border-l border-border/60 bg-[hsl(var(--surface-1))] flex flex-col">
        <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground/60 border-b border-border/60">
          Reasoning · this file
        </div>
        <div className="px-3 py-3 text-[11px] text-muted-foreground/60 italic">
          No agent reasoning available for this file.
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[280px] flex-shrink-0 border-l border-border/60 bg-[hsl(var(--surface-1))] flex flex-col">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground/60 border-b border-border/60 flex-shrink-0">
        Reasoning · this file
      </div>
      <ul className="flex-1 overflow-y-auto py-1">
        {allTurns.map((turn) => {
          const isActive = activeTurnIndex === turn.turnIndex;
          const isExpanded = expanded.has(turn.turnIndex);
          const isUnmapped = unmappedTurns.includes(turn);
          const text = turn.reasoningText.trim();
          const lines = text.split('\n');
          const showExpander = lines.length > COLLAPSED_LINES;
          const visibleText = isExpanded ? text : lines.slice(0, COLLAPSED_LINES).join('\n');

          return (
            <li key={`${turn.messageId}-${turn.toolUseId}`}>
              <button
                type="button"
                onClick={() => onTurnClick(turn.turnIndex)}
                className={[
                  'w-full text-left px-3 py-2 border-l-2 transition-colors',
                  isActive
                    ? 'bg-primary/10 border-primary'
                    : 'border-transparent hover:bg-[hsl(var(--surface-2))]',
                ].join(' ')}
              >
                <div className="text-[10px] text-muted-foreground/60 mb-1 tabular-nums">
                  Turn {turn.turnIndex} · {turn.toolName}
                  {isUnmapped && <span className="ml-1 italic">· location not found</span>}
                </div>
                {text ? (
                  <div className="whitespace-pre-wrap text-[11px] leading-snug text-foreground/85">
                    {visibleText}
                  </div>
                ) : (
                  <div className="text-[11px] italic text-muted-foreground/60">
                    (no reasoning text)
                  </div>
                )}
                {showExpander && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(turn.turnIndex);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleExpand(turn.turnIndex);
                      }
                    }}
                    className="mt-1 inline-block text-[10px] text-primary hover:underline cursor-pointer"
                  >
                    {isExpanded ? 'show less' : 'show more'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
