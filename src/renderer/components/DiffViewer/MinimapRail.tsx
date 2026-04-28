import React from 'react';
import type { DiffHunk } from '../../../shared/types';

// ── Scrollbar minimap types ─────────────────────────────────

export interface ChangeMarker {
  /** 0–1 start position within the total line count */
  position: number;
  /** 0–1 span (at least 1 line tall) */
  span: number;
  type: 'add' | 'delete';
}

/** Merge consecutive same-type changed lines into single markers */
export function buildChangeMarkers(hunks: DiffHunk[]): ChangeMarker[] {
  let totalLines = 0;
  for (const hunk of hunks) {
    totalLines += 1 + hunk.lines.length;
  }
  if (totalLines === 0) return [];

  const markers: ChangeMarker[] = [];
  let lineIdx = 0;
  for (const hunk of hunks) {
    lineIdx += 1; // hunk header
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'delete') {
        const prev = markers[markers.length - 1];
        const pos = lineIdx / totalLines;
        const oneLine = 1 / totalLines;
        // Merge into previous marker if same type and adjacent
        if (prev && prev.type === line.type && Math.abs(prev.position + prev.span - pos) < 1e-9) {
          prev.span += oneLine;
        } else {
          markers.push({ position: pos, span: oneLine, type: line.type });
        }
      }
      lineIdx++;
    }
  }
  return markers;
}

export interface MinimapRailProps {
  hunks: DiffHunk[];
  /** The DiffPane's scroll container — clicking the rail scrolls it. */
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}

export function MinimapRail({ hunks, scrollContainerRef }: MinimapRailProps): JSX.Element | null {
  const changeMarkers = React.useMemo(() => buildChangeMarkers(hunks), [hunks]);

  if (changeMarkers.length === 0) return null;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-[8px] z-20 pointer-events-auto"
      onClick={(e) => {
        if (!scrollContainerRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientY - rect.top) / rect.height;
        scrollContainerRef.current.scrollTop =
          ratio *
          (scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight);
      }}
    >
      {changeMarkers.map((marker, i) => (
        <div
          key={i}
          className={
            marker.type === 'add' ? 'bg-[hsl(var(--git-added))]' : 'bg-[hsl(var(--git-deleted))]'
          }
          style={{
            position: 'absolute',
            top: `${marker.position * 100}%`,
            left: 0,
            right: 0,
            height: `max(2px, ${marker.span * 100}%)`,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}
