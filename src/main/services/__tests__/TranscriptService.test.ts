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
    // Second edit happens after a second user prompt — turnIndex 2.
    expect(turns[1].turnIndex).toBe(2);
    expect(turns[1].newStrings).toEqual(['submitEntry']);
  });

  it('falls back to thinking text when the turn has no visible text block', () => {
    const turns = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-basic.jsonl'),
      '/repo/auth.ts',
    );
    // The second edit was preceded only by a thinking block, no text.
    expect(turns[1].reasoningText).toContain('Renaming handleScan');
  });

  it('looks forward within the turn when a tool call has no preceding reasoning', () => {
    const turns = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-after-text.jsonl'),
      '/repo/a.ts',
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].reasoningText).toContain('Done — removed the comments');
  });

  it('uses the most recent text block for each tool call (not accumulated)', () => {
    const turns = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-basic.jsonl'),
      '/repo/login.tsx',
    );
    expect(turns[0].reasoningText).toBe('Now writing the new login screen.');
    expect(turns[0].reasoningText).not.toContain('auth context');
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

  it('returns empty reasoning text when no text or thinking block precedes the tool call in the turn', () => {
    const turns = TranscriptService.parseJsonl(
      path.join(FIXTURES, 'transcript-malformed.jsonl'),
      '/repo/b.ts',
    );
    expect(turns[0].reasoningText).toBe('');
  });
});
