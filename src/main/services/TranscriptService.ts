import * as fs from 'fs';
import * as path from 'path';
import type { ReasoningTurn } from '../../shared/types';
import { DatabaseService } from './DatabaseService';
import { getLatestSessionJsonlPath, getSessionJsonlPath } from './claudeSessionPaths';

interface CachedParse {
  mtimeMs: number;
  turnsByFile: Map<string, ReasoningTurn[]>;
}

const cache = new Map<string, CachedParse>();

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function getBlocks(parsed: unknown): ContentBlock[] | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const msg = (parsed as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (!msg) return null;
  const content = msg.content;
  if (!Array.isArray(content)) return null;
  return content as ContentBlock[];
}

/**
 * A user line is a "real prompt" (turn boundary) when its content is a string
 * or a list of text blocks. When it's a list of tool_result blocks, it's a
 * mid-turn tool result — not a turn boundary.
 */
function isUserPrompt(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== 'user') return false;
  const msg = obj.message as Record<string, unknown> | undefined;
  if (!msg) return false;
  const content = msg.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text',
  );
}

function extractNewStrings(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === 'Edit' && typeof input.new_string === 'string') {
    return [input.new_string];
  }
  if (toolName === 'Write' && typeof input.content === 'string') {
    return [input.content];
  }
  if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
    return (input.edits as Array<Record<string, unknown>>)
      .map((e) => (typeof e.new_string === 'string' ? e.new_string : null))
      .filter((s): s is string => s !== null);
  }
  return [];
}

/**
 * Walk the JSONL line-by-line. Claude Code writes each assistant content block
 * (text, thinking, tool_use) as its own line, so we accumulate the most recent
 * text/thinking from a turn and attribute it to subsequent tool_use blocks
 * until the next user prompt resets the turn.
 */
function parseLines(lines: string[]): Map<string, ReasoningTurn[]> {
  const byFile = new Map<string, ReasoningTurn[]>();
  let turnIndex = 0;
  let currentText = ''; // Preferred: visible text the agent told the user.
  let currentThinking = ''; // Fallback: extended-thinking content.

  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (isUserPrompt(parsed)) {
      turnIndex += 1;
      currentText = '';
      currentThinking = '';
      continue;
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.type !== 'assistant') continue;

    const blocks = getBlocks(parsed);
    if (!blocks) continue;

    const messageId =
      typeof (obj.message as Record<string, unknown>).id === 'string'
        ? ((obj.message as Record<string, unknown>).id as string)
        : '';
    const timestamp = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) || 0 : 0;

    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        // Overwrite, not accumulate: the closest text to a tool_use is the
        // most accurate reasoning for it.
        currentText = block.text;
        continue;
      }
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        currentThinking = block.thinking;
        continue;
      }
      if (block.type !== 'tool_use' || !block.name || !block.input) continue;
      if (block.name !== 'Edit' && block.name !== 'Write' && block.name !== 'MultiEdit') {
        continue;
      }
      const filePath = typeof block.input.file_path === 'string' ? block.input.file_path : null;
      if (!filePath) continue;

      const reasoningText = currentText || currentThinking;

      const turn: ReasoningTurn = {
        messageId,
        toolUseId: block.id ?? '',
        turnIndex: turnIndex || 1,
        toolName: block.name,
        filePath,
        reasoningText,
        newStrings: extractNewStrings(block.name, block.input),
        timestamp,
      };
      const list = byFile.get(filePath) ?? [];
      list.push(turn);
      byFile.set(filePath, list);
    }
  }
  return byFile;
}

export class TranscriptService {
  /**
   * Parse a JSONL file and return reasoning turns that touched `filePath`.
   * Memoized on (path, mtime).
   */
  static parseJsonl(jsonlPath: string, filePath: string): ReasoningTurn[] {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(jsonlPath);
    } catch {
      return [];
    }
    let entry = cache.get(jsonlPath);
    if (!entry || entry.mtimeMs !== stat.mtimeMs) {
      const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n');
      entry = { mtimeMs: stat.mtimeMs, turnsByFile: parseLines(lines) };
      cache.set(jsonlPath, entry);
    }
    return entry.turnsByFile.get(filePath) ?? [];
  }

  /**
   * Public API: given a taskId and a file path, return the reasoning turns.
   * Looks up the task's cwd and lastSessionId via DatabaseService.
   */
  static getReasoningForFile(taskId: string, filePath: string): ReasoningTurn[] {
    const task = DatabaseService.getTask(taskId);
    if (!task) return [];
    // Prefer the captured lastSessionId; fall back to the most recently
    // modified JSONL in the cwd when the SessionStart hook hasn't populated it.
    const jsonlPath =
      (task.lastSessionId && getSessionJsonlPath(task.path, task.lastSessionId)) ||
      getLatestSessionJsonlPath(task.path);
    if (!jsonlPath) return [];
    // The diff passes repo-relative paths (e.g. "src/auth.ts"), but the JSONL
    // records absolute paths from Edit/Write tool calls. Resolve against the
    // task's cwd so the lookup key matches what was stored.
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(task.path, filePath);
    return TranscriptService.parseJsonl(jsonlPath, absolutePath);
  }

  static __clearCacheForTests(): void {
    cache.clear();
  }
}
