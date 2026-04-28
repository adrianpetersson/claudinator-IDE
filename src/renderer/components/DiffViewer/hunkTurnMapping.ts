import type { DiffHunk, ReasoningTurn } from '../../../shared/types';

export interface HunkTurnMapping {
  /** For each hunk index, the turnIndex values that produced it. */
  hunkToTurns: number[][];
  /** Turns that couldn't be located in any hunk. */
  unmappedTurns: ReasoningTurn[];
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function hunkContainsAddedLine(hunk: DiffHunk, needle: string): boolean {
  if (!needle) return false;
  return hunk.lines.some((l) => l.type === 'add' && l.content.trim() === needle);
}

export function mapHunksToTurns(hunks: DiffHunk[], turns: ReasoningTurn[]): HunkTurnMapping {
  const hunkToTurns: number[][] = hunks.map(() => []);
  const unmappedTurns: ReasoningTurn[] = [];

  for (const turn of turns) {
    const needles = turn.newStrings.map(firstNonEmptyLine).filter(Boolean);
    if (needles.length === 0) {
      unmappedTurns.push(turn);
      continue;
    }
    let mapped = false;
    for (let h = 0; h < hunks.length; h++) {
      if (needles.some((n) => hunkContainsAddedLine(hunks[h], n))) {
        hunkToTurns[h].push(turn.turnIndex);
        mapped = true;
      }
    }
    if (!mapped) unmappedTurns.push(turn);
  }

  return { hunkToTurns, unmappedTurns };
}
