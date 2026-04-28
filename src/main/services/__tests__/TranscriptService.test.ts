import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { TranscriptService } from '../TranscriptService';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('TranscriptService.parseJsonl', () => {
  beforeEach(() => {
    TranscriptService.__clearCacheForTests();
  });

  it('returns turns for a file across multiple assistant messages', () => {
    const turns = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-basic.jsonl'),
      '/repo/auth.ts',
    );
    expect(turns).toHaveLength(2);
    expect(turns[0].toolName).toBe('Edit');
    expect(turns[0].turnIndex).toBe(1);
    expect(turns[0].reasoningText).toContain('auth context');
    expect(turns[0].newStrings).toEqual(['const tokenConfig = useAuthContext();\nconst x = 1']);
    expect(turns[1].turnIndex).toBe(3);
    expect(turns[1].newStrings).toEqual(['submitEntry']);
  });

  it('returns the single Write turn for a file written once', () => {
    const turns = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-basic.jsonl'),
      '/repo/login.tsx',
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].toolName).toBe('Write');
    expect(turns[0].newStrings[0]).toContain('export function Login');
  });

  it('returns [] for a file the transcript never touched', () => {
    const turns = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-basic.jsonl'),
      '/repo/never.ts',
    );
    expect(turns).toEqual([]);
  });

  it('skips malformed lines and returns the rest', () => {
    const turnsA = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-malformed.jsonl'),
      '/repo/a.ts',
    );
    const turnsB = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-malformed.jsonl'),
      '/repo/b.ts',
    );
    expect(turnsA).toHaveLength(1);
    expect(turnsB).toHaveLength(1);
    expect(turnsB[0].toolName).toBe('Write');
  });

  it('returns empty reasoning text when the assistant message had no text block', () => {
    const turns = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-malformed.jsonl'),
      '/repo/b.ts',
    );
    expect(turns[0].reasoningText).toBe('');
  });
});
