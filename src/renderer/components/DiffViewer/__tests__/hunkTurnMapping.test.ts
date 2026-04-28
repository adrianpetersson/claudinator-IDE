import { describe, it, expect } from 'vitest';
import { mapHunksToTurns } from '../hunkTurnMapping';
import type { DiffHunk, DiffLine, ReasoningTurn } from '../../../../shared/types';

function line(type: DiffLine['type'], content: string, n: number): DiffLine {
  return {
    type,
    content,
    oldLineNumber: type === 'add' ? null : n,
    newLineNumber: type === 'delete' ? null : n,
  };
}

function turn(overrides: Partial<ReasoningTurn>): ReasoningTurn {
  return {
    messageId: 'm',
    toolUseId: 't',
    turnIndex: 1,
    toolName: 'Edit',
    filePath: '/x',
    reasoningText: '',
    newStrings: [],
    timestamp: 0,
    ...overrides,
  };
}

describe('mapHunksToTurns', () => {
  const hunks: DiffHunk[] = [
    {
      header: '@@',
      lines: [
        line('context', 'before', 1),
        line('add', 'const tokenConfig = useAuthContext();', 2),
        line('add', 'const x = 1', 3),
      ],
    },
    {
      header: '@@',
      lines: [
        line('delete', 'const handleScan = () => {}', 10),
        line('add', 'const submitEntry = () => {}', 10),
      ],
    },
  ];

  it('maps a turn whose new_string starts a line in hunk 0', () => {
    const t = turn({
      turnIndex: 1,
      newStrings: ['const tokenConfig = useAuthContext();\nconst x = 1'],
    });
    const result = mapHunksToTurns(hunks, [t]);
    expect(result.hunkToTurns[0]).toEqual([1]);
    expect(result.hunkToTurns[1]).toEqual([]);
    expect(result.unmappedTurns).toEqual([]);
  });

  it('maps a turn whose new_string lands in hunk 1', () => {
    const t = turn({ turnIndex: 2, newStrings: ['const submitEntry = () => {}'] });
    const result = mapHunksToTurns(hunks, [t]);
    expect(result.hunkToTurns[0]).toEqual([]);
    expect(result.hunkToTurns[1]).toEqual([2]);
  });

  it('marks a turn as unmapped when its new_string is not in any hunk', () => {
    const t = turn({ turnIndex: 3, newStrings: ['totally unrelated'] });
    const result = mapHunksToTurns(hunks, [t]);
    expect(result.hunkToTurns.every((arr) => arr.length === 0)).toBe(true);
    expect(result.unmappedTurns.map((x) => x.turnIndex)).toEqual([3]);
  });

  it('handles a turn with empty newStrings (e.g. malformed) by leaving it unmapped', () => {
    const t = turn({ turnIndex: 4, newStrings: [] });
    const result = mapHunksToTurns(hunks, [t]);
    expect(result.unmappedTurns.map((x) => x.turnIndex)).toEqual([4]);
  });

  it('a single hunk can list multiple turns when both touched it', () => {
    const t1 = turn({ turnIndex: 1, newStrings: ['const tokenConfig = useAuthContext();'] });
    const t2 = turn({ turnIndex: 2, newStrings: ['const x = 1'] });
    const result = mapHunksToTurns(hunks, [t1, t2]);
    expect(result.hunkToTurns[0].sort()).toEqual([1, 2]);
  });
});
