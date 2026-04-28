# Diff Modal Reasoning Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side "reasoning sidebar" to the existing fullscreen diff modal in Claudinator. Each card shows an agent turn that touched the current file, with click-to-sync between cards and hunks.

**Architecture:** Read-only against Claude Code's session transcript at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. New `TranscriptService` in main parses the JSONL on demand, exposes `ReasoningTurn[]` for a given file via IPC. Renderer computes hunk↔turn line-range mapping client-side. Existing `DiffViewer.tsx` (673 lines) is split into `DiffViewer/{index,DiffPane,MinimapRail,ReasoningSidebar}.tsx` to keep each file focused.

**Tech Stack:** TypeScript, Electron (main/renderer/preload), React 18, Vitest, Drizzle (no schema changes), Tailwind. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-04-28-diff-modal-reasoning-sidebar-design.md`

---

## Files to be Created or Modified

**Created:**

- `src/main/services/claudeSessionPaths.ts` — shared util for locating Claude project dirs and session JSONL files (extracted from `ptyManager.ts`).
- `src/main/services/TranscriptService.ts` — parses session JSONL, returns reasoning turns indexed by file.
- `src/main/services/__tests__/TranscriptService.test.ts` — unit tests with JSONL fixtures.
- `src/main/services/__tests__/fixtures/transcript-basic.jsonl` — fixture: two turns, one file.
- `src/main/services/__tests__/fixtures/transcript-malformed.jsonl` — fixture: a corrupt line plus valid lines.
- `src/main/ipc/transcriptIpc.ts` — registers `transcript:getReasoningForFile`.
- `src/renderer/components/DiffViewer/index.tsx` — modal shell, fetches reasoning, owns activeTurnId state.
- `src/renderer/components/DiffViewer/DiffPane.tsx` — extracted diff rendering (was inside `DiffViewer.tsx`).
- `src/renderer/components/DiffViewer/MinimapRail.tsx` — extracted scrollbar minimap.
- `src/renderer/components/DiffViewer/ReasoningSidebar.tsx` — the new sidebar.
- `src/renderer/components/DiffViewer/hunkTurnMapping.ts` — pure function mapping hunks → turns.
- `src/renderer/components/DiffViewer/__tests__/hunkTurnMapping.test.ts` — unit tests.

**Modified:**

- `src/main/services/ptyManager.ts` — replace inline `findClaudeProjectDir`/`hasSessionForId` calls with imports from `claudeSessionPaths.ts`.
- `src/main/ipc/index.ts` — register the new IPC.
- `src/main/preload.ts` — expose `electronAPI.getReasoningForFile`.
- `src/types/electron-api.d.ts` — add the typed method.
- `src/shared/types.ts` — add `ReasoningTurn`.

**Deleted:**

- `src/renderer/components/DiffViewer.tsx` — replaced by the directory above. Imports of `'./DiffViewer'` keep working because the directory has an `index.tsx`.

---

## Conventions

- **Tests:** `pnpm test <pattern>` runs the full Vitest suite once. Use `pnpm test TranscriptService` to scope.
- **Type-check:** `pnpm type-check` (covers both renderer and main tsconfigs). Run after every task that changes types or signatures.
- **Commits:** small, focused, one per task. No AI attribution per the project's commit rules.
- **No new lint/format steps:** Husky + lint-staged handles staged files automatically on commit.

---

### Task 1: Add shared `ReasoningTurn` type

**Files:**

- Modify: `src/shared/types.ts` (append at the bottom)

- [ ] **Step 1: Append the new type to `src/shared/types.ts`**

```ts
// ── Reasoning Sidebar Types ─────────────────────────────────

/**
 * One agent turn that performed a tool call against a file in the user's task.
 * Sourced from Claude Code's session transcript JSONL.
 */
export interface ReasoningTurn {
  /** Stable id from the assistant message in the transcript. */
  messageId: string;
  /** Stable id of the tool_use block within that message. */
  toolUseId: string;
  /** 1-based index of the assistant turn in the conversation. */
  turnIndex: number;
  /** Edit | Write | MultiEdit. Other tools are filtered out at the service level. */
  toolName: 'Edit' | 'Write' | 'MultiEdit';
  /** Absolute file path the tool touched. */
  filePath: string;
  /** The agent's text content from the same assistant message — the "why". May be empty. */
  reasoningText: string;
  /**
   * For Edit/MultiEdit: the new_string(s) the turn introduced. The renderer searches for
   * these in the file's current content to compute a line range for highlight/scroll.
   * For Write: a single entry containing the full new content.
   */
  newStrings: string[];
  /** Unix ms timestamp from the transcript line, for ordering. */
  timestamp: number;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: passes (this is a pure additive change).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "Add ReasoningTurn shared type for diff sidebar"
```

---

### Task 2: Extract `claudeSessionPaths.ts` utility

The two helpers `findClaudeProjectDir` and `hasSessionForId` currently live as private functions inside `ptyManager.ts`. Both `ptyManager` and the new `TranscriptService` need them. Extract first to keep the service test-friendly.

**Files:**

- Create: `src/main/services/claudeSessionPaths.ts`
- Modify: `src/main/services/ptyManager.ts:38-77` (the function definitions and their internal call sites)

- [ ] **Step 1: Create `src/main/services/claudeSessionPaths.ts`**

```ts
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Locate the Claude projects directory for a given cwd.
 * Claude stores sessions under ~/.claude/projects/<encoded-cwd>/.
 */
export function findClaudeProjectDir(cwd: string): string | null {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return null;

    // Path-based: slashes → hyphens (the primary naming scheme)
    const pathBased = path.join(projectsDir, cwd.replace(/\//g, '-'));
    if (fs.existsSync(pathBased)) return pathBased;

    // Partial match: last 3 path segments
    const parts = cwd.split('/').filter((p) => p.length > 0);
    const suffix = parts.slice(-3).join('-');
    const dirs = fs.readdirSync(projectsDir);
    const match = dirs.find((d) => d.endsWith(suffix));
    if (match) return path.join(projectsDir, match);

    return null;
  } catch (err) {
    console.error('[findClaudeProjectDir] Failed to scan projects dir:', err);
    return null;
  }
}

/** Check whether Claude has a session file for the given UUID in this cwd. */
export function hasSessionForId(cwd: string, sessionId: string): boolean {
  const projDir = findClaudeProjectDir(cwd);
  if (!projDir) return false;
  return fs.existsSync(path.join(projDir, `${sessionId}.jsonl`));
}

/** Check whether Claude has any jsonl history for this cwd. */
export function hasAnySessionForCwd(cwd: string): boolean {
  const projDir = findClaudeProjectDir(cwd);
  if (!projDir) return false;
  try {
    return fs.readdirSync(projDir).some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

/** Return the absolute path to a session JSONL file, or null if missing. */
export function getSessionJsonlPath(cwd: string, sessionId: string): string | null {
  const projDir = findClaudeProjectDir(cwd);
  if (!projDir) return null;
  const candidate = path.join(projDir, `${sessionId}.jsonl`);
  return fs.existsSync(candidate) ? candidate : null;
}
```

- [ ] **Step 2: Update `src/main/services/ptyManager.ts` to import from the new util**

Delete the local `findClaudeProjectDir`, `hasSessionForId`, and `hasAnySessionForCwd` definitions (the three helpers around lines 38-77). Add this import near the existing imports at the top of the file:

```ts
import { findClaudeProjectDir, hasSessionForId, hasAnySessionForCwd } from './claudeSessionPaths';
```

Leave all internal call sites (`hasSessionForId(cwd, …)`, etc.) unchanged — they now resolve to the imported functions.

- [ ] **Step 3: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 4: Run existing tests to confirm no regression**

Run: `pnpm test`
Expected: passes (no test exercises these helpers directly today, but a failure here means something else moved).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/claudeSessionPaths.ts src/main/services/ptyManager.ts
git commit -m "Extract Claude session path helpers into shared util"
```

---

### Task 3: `TranscriptService` — parse JSONL and index by file

This service knows how to find a task's session JSONL and turn it into `ReasoningTurn[]` filtered by `filePath`. It also handles `MultiEdit` (which has `edits[]`, each with its own `new_string`).

**Files:**

- Create: `src/main/services/TranscriptService.ts`
- Create: `src/main/services/__tests__/TranscriptService.test.ts`
- Create: `src/main/services/__tests__/fixtures/transcript-basic.jsonl`
- Create: `src/main/services/__tests__/fixtures/transcript-malformed.jsonl`

- [ ] **Step 1: Create the basic fixture `src/main/services/__tests__/fixtures/transcript-basic.jsonl`**

Each line is one transcript entry. This fixture has:

- Turn 1: an assistant message with text + an `Edit` tool_use against `/repo/auth.ts`.
- A user message containing the tool_result (ignored by the parser).
- Turn 2: assistant text + `Write` tool_use against `/repo/login.tsx`.
- Turn 3: assistant text + `Edit` against `/repo/auth.ts` again (so two turns touch the same file).

```jsonl
{"type":"assistant","timestamp":"2026-04-28T10:00:00.000Z","uuid":"msg-1","message":{"id":"asst-1","content":[{"type":"text","text":"Extracting auth context to keep the screen stateless."},{"type":"tool_use","id":"tu-1","name":"Edit","input":{"file_path":"/repo/auth.ts","old_string":"const x = 1","new_string":"const tokenConfig = useAuthContext();\nconst x = 1"}}]}}
{"type":"user","timestamp":"2026-04-28T10:00:01.000Z","uuid":"u-1","message":{"content":[{"type":"tool_result","tool_use_id":"tu-1","content":"ok"}]}}
{"type":"assistant","timestamp":"2026-04-28T10:00:02.000Z","uuid":"msg-2","message":{"id":"asst-2","content":[{"type":"text","text":"Now writing the new login screen."},{"type":"tool_use","id":"tu-2","name":"Write","input":{"file_path":"/repo/login.tsx","content":"export function Login() { return null }"}}]}}
{"type":"assistant","timestamp":"2026-04-28T10:00:03.000Z","uuid":"msg-3","message":{"id":"asst-3","content":[{"type":"text","text":"Renaming handleScan to submitEntry."},{"type":"tool_use","id":"tu-3","name":"Edit","input":{"file_path":"/repo/auth.ts","old_string":"handleScan","new_string":"submitEntry"}}]}}
```

- [ ] **Step 2: Create the malformed fixture `src/main/services/__tests__/fixtures/transcript-malformed.jsonl`**

```jsonl
{"type":"assistant","timestamp":"2026-04-28T10:00:00.000Z","uuid":"msg-1","message":{"id":"asst-1","content":[{"type":"text","text":"Valid turn."},{"type":"tool_use","id":"tu-1","name":"Edit","input":{"file_path":"/repo/a.ts","old_string":"a","new_string":"b"}}]}}
{this is not valid json
{"type":"assistant","timestamp":"2026-04-28T10:00:02.000Z","uuid":"msg-2","message":{"id":"asst-2","content":[{"type":"tool_use","id":"tu-2","name":"Write","input":{"file_path":"/repo/b.ts","content":"hello"}}]}}
```

- [ ] **Step 3: Write `src/main/services/__tests__/TranscriptService.test.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test TranscriptService`
Expected: FAIL — `TranscriptService` does not exist yet.

- [ ] **Step 5: Implement `src/main/services/TranscriptService.ts`**

```ts
import * as fs from 'fs';
import type { ReasoningTurn } from '../../shared/types';
import { DatabaseService } from './DatabaseService';
import { getSessionJsonlPath } from './claudeSessionPaths';

interface CachedParse {
  mtimeMs: number;
  turnsByFile: Map<string, ReasoningTurn[]>;
}

const cache = new Map<string, CachedParse>();

interface AssistantContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AssistantLine {
  type: 'assistant';
  timestamp: string;
  message: { id: string; content: AssistantContentBlock[] };
}

function isAssistantLine(parsed: unknown): parsed is AssistantLine {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== 'assistant') return false;
  const msg = obj.message as Record<string, unknown> | undefined;
  return !!msg && Array.isArray(msg.content);
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

function parseLines(lines: string[]): Map<string, ReasoningTurn[]> {
  const byFile = new Map<string, ReasoningTurn[]>();
  let assistantTurnIndex = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isAssistantLine(parsed)) continue;

    assistantTurnIndex += 1;
    const text = parsed.message.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
    const timestamp = Date.parse(parsed.timestamp) || 0;

    for (const block of parsed.message.content) {
      if (block.type !== 'tool_use' || !block.name || !block.input) continue;
      if (block.name !== 'Edit' && block.name !== 'Write' && block.name !== 'MultiEdit') {
        continue;
      }
      const filePath = typeof block.input.file_path === 'string' ? block.input.file_path : null;
      if (!filePath) continue;

      const turn: ReasoningTurn = {
        messageId: parsed.message.id,
        toolUseId: block.id ?? '',
        turnIndex: assistantTurnIndex,
        toolName: block.name,
        filePath,
        reasoningText: text,
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
   * Uses DatabaseService to resolve the task's cwd and lastSessionId.
   */
  static async getReasoningForFile(taskId: string, filePath: string): Promise<ReasoningTurn[]> {
    const task = await DatabaseService.getTaskById(taskId);
    if (!task || !task.lastSessionId) return [];
    const jsonlPath = getSessionJsonlPath(task.path, task.lastSessionId);
    if (!jsonlPath) return [];
    return TranscriptService.parseJsonl(jsonlPath, filePath);
  }

  static __clearCacheForTests(): void {
    cache.clear();
  }
}
```

- [ ] **Step 6: Verify `DatabaseService.getTaskById` exists with the expected shape**

Run: `grep -n "getTaskById" src/main/services/DatabaseService.ts`
Expected: at least one match. If missing, replace the body of `getReasoningForFile` with the equivalent query the rest of the codebase uses for tasks (search `db.select().from(tasks)` for the pattern). Update this step in place if the lookup signature differs — do not leave it broken.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test TranscriptService`
Expected: all 5 tests pass.

- [ ] **Step 8: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add src/main/services/TranscriptService.ts src/main/services/__tests__/
git commit -m "Add TranscriptService for parsing Claude session reasoning"
```

---

### Task 4: IPC handler + preload exposure

**Files:**

- Create: `src/main/ipc/transcriptIpc.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/types/electron-api.d.ts`

- [ ] **Step 1: Create `src/main/ipc/transcriptIpc.ts`**

Mirror the style of the smallest existing handler (e.g. parts of `dbIpc.ts`). The contract returns `IpcResponse<ReasoningTurn[]>` consistent with the rest of the app.

```ts
import { ipcMain } from 'electron';
import type { IpcResponse, ReasoningTurn } from '../../shared/types';
import { TranscriptService } from '../services/TranscriptService';

export function registerTranscriptIpc(): void {
  ipcMain.handle(
    'transcript:getReasoningForFile',
    async (
      _event,
      args: { taskId: string; filePath: string },
    ): Promise<IpcResponse<ReasoningTurn[]>> => {
      try {
        const turns = await TranscriptService.getReasoningForFile(args.taskId, args.filePath);
        return { success: true, data: turns };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { success: false, error: message };
      }
    },
  );
}
```

- [ ] **Step 2: Verify `IpcResponse` is already exported from `src/shared/types.ts`**

Run: `grep -n "IpcResponse" src/shared/types.ts`
Expected: at least one match — there's an existing exported type. If the shape differs from `{ success, data?, error? }`, match the existing one exactly in Step 1 above before continuing.

- [ ] **Step 3: Register the new IPC in `src/main/ipc/index.ts`**

Add the import and call:

```ts
import { registerTranscriptIpc } from './transcriptIpc';
```

And inside `registerAllIpc()`, append:

```ts
registerTranscriptIpc();
```

- [ ] **Step 4: Expose via preload — add to `src/main/preload.ts`**

Inside the `contextBridge.exposeInMainWorld('electronAPI', { ... })` object, add a new entry near the other database/transcript-adjacent methods:

```ts
  // Transcript reasoning
  getReasoningForFile: (args: { taskId: string; filePath: string }) =>
    ipcRenderer.invoke('transcript:getReasoningForFile', args),
```

- [ ] **Step 5: Add the typed method to `src/types/electron-api.d.ts`**

Find the `interface ElectronAPI` (or equivalent) and add:

```ts
getReasoningForFile: (args: { taskId: string; filePath: string }) =>
  Promise<IpcResponse<ReasoningTurn[]>>;
```

Add `ReasoningTurn` to the import block at the top of the file alongside the other `shared/types` imports.

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 7: Smoke-test in dev**

Run: `pnpm dev`
In the renderer devtools console once the app loads, paste:

```js
window.electronAPI.getReasoningForFile({ taskId: 'nonexistent', filePath: '/tmp/x' });
```

Expected: a resolved Promise with `{ success: true, data: [] }` — i.e. no throw, just an empty list because the task doesn't exist.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/transcriptIpc.ts src/main/ipc/index.ts src/main/preload.ts src/types/electron-api.d.ts
git commit -m "Wire transcript:getReasoningForFile IPC end-to-end"
```

---

### Task 5: Hunk → turn line-range mapping (pure function)

This is the trickiest piece, isolated as a pure function for easy testing. Strategy: for each turn, search for the FIRST `new_string` in the diff's _added_ lines. If found, the turn maps to the hunk containing that line. If not, the turn is "unmapped" — it still appears in the sidebar but has no hunk highlight.

We cheat a little: rather than the real file, we search inside the diff's added-line content. The `new_string` is a substring; we match the first non-empty line of `new_string` against added lines. This is approximate but correct for the common case.

**Files:**

- Create: `src/renderer/components/DiffViewer/hunkTurnMapping.ts`
- Create: `src/renderer/components/DiffViewer/__tests__/hunkTurnMapping.test.ts`

- [ ] **Step 1: Write the failing tests `src/renderer/components/DiffViewer/__tests__/hunkTurnMapping.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mapHunksToTurns } from '../hunkTurnMapping';
import type { DiffHunk, DiffLine } from '../../../../shared/types';
import type { ReasoningTurn } from '../../../../shared/types';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test hunkTurnMapping`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/components/DiffViewer/hunkTurnMapping.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test hunkTurnMapping`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/DiffViewer/
git commit -m "Add hunk-to-turn line range mapping"
```

---

### Task 6: Split `DiffViewer.tsx` into a directory (refactor only — no behavior change)

Pure refactor. Goal: at the end of this task the app looks identical to before and `pnpm type-check` passes. The next task adds the sidebar; doing both at once would make a single mega-diff hard to review.

**Files:**

- Read: `src/renderer/components/DiffViewer.tsx` (the whole file, 673 lines)
- Create: `src/renderer/components/DiffViewer/index.tsx`
- Create: `src/renderer/components/DiffViewer/DiffPane.tsx`
- Create: `src/renderer/components/DiffViewer/MinimapRail.tsx`
- Delete: `src/renderer/components/DiffViewer.tsx` (after extracting)

- [ ] **Step 1: Read the existing `DiffViewer.tsx` end-to-end to understand the boundaries**

Run: read `src/renderer/components/DiffViewer.tsx` in full. Identify three regions:

- The modal frame (header, close button, the outer flex shell, the IPC `commentSubmit` flow).
- The diff rendering body (the per-line rows, gutter, popover for comments, selection logic — the bulk of the file).
- The minimap (the section labeled `// ── Scrollbar minimap types ──` and the JSX that renders the markers rail).

The internal type definitions (`LineAddress`, `DiffComment`, `SelectionState`, `PopoverState`, `ChangeMarker`) belong with whichever component uses them. Most belong with the diff body.

- [ ] **Step 2: Create `src/renderer/components/DiffViewer/MinimapRail.tsx`**

Move the minimap-related code into this file. Export a `MinimapRail` component with this shape:

```ts
export interface MinimapRailProps {
  hunks: DiffHunk[];
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}
export function MinimapRail(props: MinimapRailProps): JSX.Element {
  /* … existing JSX … */
}
```

Move the `ChangeMarker` interface and the `// Merge consecutive same-type changed lines` helper into this file alongside the component.

- [ ] **Step 3: Create `src/renderer/components/DiffViewer/DiffPane.tsx`**

Move the diff body (line rendering, comment popover, selection logic) into this file. Export:

```ts
export interface DiffPaneProps {
  diff: DiffResult;
  activeTaskId: string | null;
  /** Optional: hunk indices to highlight when a sidebar card is selected. Empty in this task. */
  highlightedHunkIndices?: number[];
  /** Optional: invoked when the user clicks a hunk header. No-op in this task. */
  onHunkClick?: (hunkIndex: number) => void;
  /** Forwarded to the inner scroll container so MinimapRail can drive it. */
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}
export function DiffPane(props: DiffPaneProps): JSX.Element {
  /* … existing JSX … */
}
```

The `highlightedHunkIndices` and `onHunkClick` props are accepted but unused in this task — Task 7 wires them. Defining them now prevents a second prop-shape change later.

- [ ] **Step 4: Create `src/renderer/components/DiffViewer/index.tsx`**

This becomes the new modal shell. It replaces the old `DiffViewer.tsx` and exports `DiffViewer` with the same props as before so all importers keep working.

```tsx
import React, { useRef } from 'react';
import { X } from 'lucide-react';
import type { DiffResult } from '../../../shared/types';
import { DiffPane } from './DiffPane';
import { MinimapRail } from './MinimapRail';

interface DiffViewerProps {
  diff: DiffResult;
  loading?: boolean;
  activeTaskId: string | null;
  onClose: () => void;
}

export function DiffViewer({ diff, loading, activeTaskId, onClose }: DiffViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Keep the existing modal frame markup (header bar with file path + +/- counts + close X).
  // Inside the body, render: <DiffPane …/> and <MinimapRail …/> in a flex row, exactly as before.
  // The wrapping/loading/empty-state behavior from the original file stays here.
  return (
    /* … original modal frame, with body replaced by … */
    <div className="flex flex-1 overflow-hidden">
      <DiffPane diff={diff} activeTaskId={activeTaskId} scrollContainerRef={scrollContainerRef} />
      <MinimapRail hunks={diff.hunks} scrollContainerRef={scrollContainerRef} />
    </div>
  );
}
```

When you do this for real, copy the _exact_ outer shell JSX from the original file — header bar, close button, ESC handling, loading state — into this `index.tsx`. The block comment above is for the body only.

- [ ] **Step 5: Delete the old `src/renderer/components/DiffViewer.tsx`**

```bash
rm src/renderer/components/DiffViewer.tsx
```

The directory's `index.tsx` resolves the same import paths (`'./DiffViewer'`).

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 7: Run the dev app and smoke-test**

Run: `pnpm dev`. In the running app:

- Open a project that has uncommitted changes.
- Open the diff modal for a changed file.
- Verify: the diff renders identically, the minimap appears on the right, scrolling works, comment popovers still work if you select lines, the close button works, ESC closes the modal.

If anything looks off, fix it before committing — the refactor is only successful if behavior is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/DiffViewer/ src/renderer/components/DiffViewer.tsx
git commit -m "Split DiffViewer into shell, pane, and minimap modules"
```

---

### Task 7: Add `ReasoningSidebar` and wire it up

**Files:**

- Create: `src/renderer/components/DiffViewer/ReasoningSidebar.tsx`
- Modify: `src/renderer/components/DiffViewer/index.tsx`
- Modify: `src/renderer/components/DiffViewer/DiffPane.tsx` (consume `highlightedHunkIndices` + `onHunkClick`)

- [ ] **Step 1: Create `src/renderer/components/DiffViewer/ReasoningSidebar.tsx`**

```tsx
import React, { useState } from 'react';
import type { ReasoningTurn } from '../../../shared/types';

const COLLAPSED_LINES = 3;
const SIDEBAR_WIDTH = 280;

export interface ReasoningSidebarProps {
  turns: ReasoningTurn[];
  unmappedTurns: ReasoningTurn[];
  activeTurnIndex: number | null;
  onTurnClick: (turnIndex: number) => void;
  loading?: boolean;
}

export function ReasoningSidebar({
  turns,
  unmappedTurns,
  activeTurnIndex,
  onTurnClick,
  loading,
}: ReasoningSidebarProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const allTurns = [...turns, ...unmappedTurns];

  if (loading) {
    return (
      <aside
        className="border-l border-border bg-surface-0 px-3 py-3 text-xs text-muted-foreground"
        style={{ width: SIDEBAR_WIDTH }}
      >
        Loading reasoning…
      </aside>
    );
  }

  if (allTurns.length === 0) {
    return (
      <aside
        className="border-l border-border bg-surface-0 px-3 py-3 text-xs text-muted-foreground"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <div className="mb-1 uppercase tracking-wide opacity-60">Reasoning · this file</div>
        <p>No agent reasoning available for this file.</p>
      </aside>
    );
  }

  return (
    <aside
      className="border-l border-border bg-surface-0 overflow-y-auto"
      style={{ width: SIDEBAR_WIDTH }}
    >
      <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
        Reasoning · this file
      </div>
      <ul className="py-1">
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
                    : 'border-transparent hover:bg-surface-1',
                ].join(' ')}
              >
                <div className="text-[10px] text-muted-foreground mb-1">
                  Turn {turn.turnIndex} · {turn.toolName}
                  {isUnmapped && ' · (location not found)'}
                </div>
                {text ? (
                  <div className="whitespace-pre-wrap text-xs leading-snug">{visibleText}</div>
                ) : (
                  <div className="text-xs italic text-muted-foreground">(no reasoning text)</div>
                )}
                {showExpander && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(turn.turnIndex)) next.delete(turn.turnIndex);
                        else next.add(turn.turnIndex);
                        return next;
                      });
                    }}
                    className="mt-1 inline-block text-[10px] text-primary hover:underline"
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
```

- [ ] **Step 2: Update `DiffPane` to honor `highlightedHunkIndices` + `onHunkClick`**

In `src/renderer/components/DiffViewer/DiffPane.tsx`:

- Where each hunk is rendered, accept `props.highlightedHunkIndices` and apply a CSS class (e.g. ring or background tint) to highlighted hunks. Use existing tokens: a subtle `bg-primary/5` outline on the hunk container is fine.
- Wire the hunk header (the `@@` line) onClick to `props.onHunkClick?.(hunkIndex)` — no other markup changes.

If a hunk is highlighted, scroll it into view: when `highlightedHunkIndices` changes, find the first highlighted hunk's DOM node (use a `data-hunk-index` attribute on each hunk wrapper) and call `scrollIntoView({ block: 'center', behavior: 'smooth' })` from a `useEffect`.

- [ ] **Step 3: Wire everything up in `src/renderer/components/DiffViewer/index.tsx`**

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DiffResult, ReasoningTurn } from '../../../shared/types';
import { DiffPane } from './DiffPane';
import { MinimapRail } from './MinimapRail';
import { ReasoningSidebar } from './ReasoningSidebar';
import { mapHunksToTurns } from './hunkTurnMapping';

interface DiffViewerProps {
  diff: DiffResult;
  loading?: boolean;
  activeTaskId: string | null;
  onClose: () => void;
}

export function DiffViewer({ diff, loading, activeTaskId, onClose }: DiffViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [turns, setTurns] = useState<ReasoningTurn[]>([]);
  const [reasoningLoading, setReasoningLoading] = useState(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!activeTaskId || !diff.filePath) {
      setTurns([]);
      return;
    }
    let cancelled = false;
    setReasoningLoading(true);
    window.electronAPI
      .getReasoningForFile({ taskId: activeTaskId, filePath: diff.filePath })
      .then((res) => {
        if (cancelled) return;
        setTurns(res.success && res.data ? res.data : []);
      })
      .finally(() => {
        if (!cancelled) setReasoningLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTaskId, diff.filePath]);

  const mapping = useMemo(() => mapHunksToTurns(diff.hunks, turns), [diff.hunks, turns]);
  const mappedTurns = useMemo(
    () => turns.filter((t) => !mapping.unmappedTurns.some((u) => u.turnIndex === t.turnIndex)),
    [turns, mapping.unmappedTurns],
  );

  const highlightedHunkIndices = useMemo(() => {
    if (activeTurnIndex == null) return [];
    return mapping.hunkToTurns
      .map((turnIdxs, hunkIdx) => (turnIdxs.includes(activeTurnIndex) ? hunkIdx : -1))
      .filter((i) => i >= 0);
  }, [activeTurnIndex, mapping.hunkToTurns]);

  function handleHunkClick(hunkIndex: number) {
    const turnIdxs = mapping.hunkToTurns[hunkIndex];
    if (turnIdxs.length > 0) {
      setActiveTurnIndex(turnIdxs[turnIdxs.length - 1]);
    }
  }

  // (Keep the existing outer modal markup from before — header, close button, ESC handling.)
  return (
    /* … existing modal shell … */
    <div className="flex flex-1 overflow-hidden">
      <DiffPane
        diff={diff}
        activeTaskId={activeTaskId}
        scrollContainerRef={scrollContainerRef}
        highlightedHunkIndices={highlightedHunkIndices}
        onHunkClick={handleHunkClick}
      />
      <MinimapRail hunks={diff.hunks} scrollContainerRef={scrollContainerRef} />
      <ReasoningSidebar
        turns={mappedTurns}
        unmappedTurns={mapping.unmappedTurns}
        activeTurnIndex={activeTurnIndex}
        onTurnClick={setActiveTurnIndex}
        loading={reasoningLoading}
      />
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `pnpm type-check`
Expected: passes.

- [ ] **Step 5: Smoke-test in dev**

Run: `pnpm dev`. Open a task that has been worked on by Claude Code (so its session JSONL exists at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`). Open the diff modal for a file the agent edited. Verify:

- Sidebar appears on the right with reasoning cards.
- Click a card → diff scrolls and the matching hunk is highlighted.
- Click a hunk → matching card highlights in the sidebar.
- Open the diff for a file with no agent edits → sidebar shows the empty state.
- "Show more" expands long reasoning.

If a card has no highlighted hunk after click and the turn isn't marked "(location not found)", the new_string matching is too strict — note in the commit message and revisit in a follow-up.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/DiffViewer/
git commit -m "Wire reasoning sidebar into diff modal"
```

---

## Self-Review Checklist (post-implementation)

After Task 7, run through these once before declaring done:

- `pnpm type-check` clean.
- `pnpm test` clean (TranscriptService + hunkTurnMapping tests pass; nothing else regressed).
- Manual: opening a diff modal for an agent-edited file shows reasoning; opening one for a non-agent-edited file shows the empty state cleanly.
- Old `DiffViewer.tsx` is gone; no lingering imports of the file (vs the directory).
- No `console.log` debug noise left in the new files.
