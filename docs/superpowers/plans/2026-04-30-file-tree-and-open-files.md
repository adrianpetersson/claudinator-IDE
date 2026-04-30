# File Tree & Open Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-task file tree (in `LeftSidebar`) and an "open files" pane kind (in `TerminalPaneGroup`) so the user can browse the active task's worktree and view files alongside the running Claude Code session.

**Architecture:** Main-process `FileBrowserService` owns tree walks (gitignore-aware via `git ls-files`), file reads (with binary/large guards), and chokidar watchers (one per active task). Renderer adds two components — `FileTree` and `FilePane` — and extends the `Pane` discriminated union with a `file` kind. Open file panes persist per-task in SQLite. Live updates fire over IPC push channels.

**Tech Stack:** Electron, React 18, TypeScript, better-sqlite3, Drizzle ORM (raw-SQL migrations in `migrate.ts`), chokidar (new dep), `ignore` (new dep, fallback only), Shiki (already in `FileView.tsx`), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-30-file-tree-and-open-files-design.md`.

---

## File Map

**Create:**

- `src/main/services/FileBrowserService.ts` — service (static methods, like `GitService`).
- `src/main/services/__tests__/FileBrowserService.test.ts` — unit tests.
- `src/main/ipc/fileBrowserIpc.ts` — IPC handlers.
- `src/renderer/components/FileTree.tsx` — tree component.
- `src/renderer/components/FilePane.tsx` — file pane wrapper around existing `FileView`.

**Modify:**

- `package.json` — add `chokidar`, `ignore`.
- `src/main/db/migrate.ts` — add `open_files` table.
- `src/main/db/client.ts` — add `openFilesQueries` (or new file `src/main/db/openFiles.ts` for cleanliness).
- `src/shared/types.ts` — extend `Pane` union with `{ kind: 'file'; ... }`; add `TreeNode`, `OpenFileRow`, `ReadFileResult`.
- `src/main/ipc/index.ts` — register `registerFileBrowserIpc`.
- `src/main/preload.ts` — expose `fileBrowser.*` and `openFiles.*` methods.
- `src/types/electron-api.d.ts` — type the new methods.
- `src/renderer/panes/derived.ts` — derive open-file panes from DB.
- `src/renderer/components/PaneShell.tsx` — render `FilePane` for `kind === 'file'`.
- `src/renderer/components/TerminalPaneGroup.tsx` — already pane-kind-agnostic if `PaneShell` dispatches; verify.
- `src/renderer/components/LeftSidebar.tsx` — add `<FileTree>` section.
- `src/renderer/App.tsx` — task-switch lifecycle (watch/unwatch + open-files hydration).

---

## Conventions

- **Service style:** `export class FileBrowserService { static async ... }` (mirrors `GitService`).
- **IPC response:** all request/response handlers return `IpcResponse<T> = { success: true; data: T } | { success: false; error: string }`.
- **IPC channel naming:** `fileBrowser:listTree`, `fileBrowser:readFile`, `fileBrowser:watch`, `fileBrowser:unwatch`, `openFiles:list`, `openFiles:add`, `openFiles:remove`, `openFiles:reorder`. Push events: `fileBrowser:treeChanged:<taskId>`, `fileBrowser:fileChanged:<taskId>:<encodedPath>`.
- **Migrations:** `CREATE TABLE IF NOT EXISTS` in `migrate.ts`. No new Drizzle migration files unless engineer also runs `pnpm drizzle:generate` (optional — raw SQL is the source of truth at runtime).
- **Tests:** Vitest. Place service tests in `src/main/services/__tests__/`. Use `os.tmpdir()` + `fs.mkdtempSync` for fixture worktrees.
- **Commit style:** match existing log — short imperative, no Co-Authored-By per `~/.claude/CLAUDE.md`.

---

## Task 1: Add chokidar and ignore dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

```bash
pnpm add chokidar
pnpm add ignore
pnpm add -D @types/node  # already present, but confirm
```

- [ ] **Step 2: Verify install**

```bash
node -e "console.log(require('chokidar').version || 'ok'); require('ignore'); console.log('ignore ok')"
```

Expected: prints `ok` lines without throwing.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Add chokidar and ignore deps for file browser"
```

---

## Task 2: Add open_files table and queries

**Files:**

- Modify: `src/main/db/migrate.ts`
- Create: `src/main/db/openFiles.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `OpenFileRow` to shared types**

In `src/shared/types.ts`, add (placing near other DB row types):

```ts
export interface OpenFileRow {
  id: number;
  taskId: string;
  filePath: string;
  position: number;
  openedAt: string;
}
```

- [ ] **Step 2: Add table migration**

In `src/main/db/migrate.ts`, after the `conversations` table block, add:

```ts
rawDb.exec(`
  CREATE TABLE IF NOT EXISTS open_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, file_path)
  );
`);

rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_open_files_task_id ON open_files(task_id);`);
```

- [ ] **Step 3: Create query module**

Create `src/main/db/openFiles.ts`:

```ts
import { getRawDb } from './client';
import type { OpenFileRow } from '@shared/types';

function rowToOpenFile(r: {
  id: number;
  task_id: string;
  file_path: string;
  position: number;
  opened_at: string;
}): OpenFileRow {
  return {
    id: r.id,
    taskId: r.task_id,
    filePath: r.file_path,
    position: r.position,
    openedAt: r.opened_at,
  };
}

export const openFilesQueries = {
  list(taskId: string): OpenFileRow[] {
    const db = getRawDb();
    if (!db) return [];
    const rows = db
      .prepare(
        `SELECT id, task_id, file_path, position, opened_at
         FROM open_files WHERE task_id = ? ORDER BY position ASC, id ASC`,
      )
      .all(taskId) as Parameters<typeof rowToOpenFile>[0][];
    return rows.map(rowToOpenFile);
  },

  add(taskId: string, filePath: string): OpenFileRow {
    const db = getRawDb();
    if (!db) throw new Error('DB not initialised');
    const max = db
      .prepare(`SELECT COALESCE(MAX(position), -1) AS m FROM open_files WHERE task_id = ?`)
      .get(taskId) as { m: number };
    const position = max.m + 1;
    db.prepare(
      `INSERT OR IGNORE INTO open_files (task_id, file_path, position) VALUES (?, ?, ?)`,
    ).run(taskId, filePath, position);
    const row = db
      .prepare(
        `SELECT id, task_id, file_path, position, opened_at
         FROM open_files WHERE task_id = ? AND file_path = ?`,
      )
      .get(taskId, filePath) as Parameters<typeof rowToOpenFile>[0];
    return rowToOpenFile(row);
  },

  remove(taskId: string, filePath: string): void {
    const db = getRawDb();
    if (!db) return;
    db.prepare(`DELETE FROM open_files WHERE task_id = ? AND file_path = ?`).run(taskId, filePath);
  },

  reorder(taskId: string, paths: string[]): void {
    const db = getRawDb();
    if (!db) return;
    const tx = db.transaction((p: string[]) => {
      p.forEach((fp, i) => {
        db.prepare(`UPDATE open_files SET position = ? WHERE task_id = ? AND file_path = ?`).run(
          i,
          taskId,
          fp,
        );
      });
    });
    tx(paths);
  },
};
```

- [ ] **Step 4: Smoke check**

```bash
pnpm type-check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrate.ts src/main/db/openFiles.ts src/shared/types.ts
git commit -m "Add open_files table and queries"
```

---

## Task 3: FileBrowserService.listTree (TDD)

**Files:**

- Create: `src/main/services/FileBrowserService.ts`
- Create: `src/main/services/__tests__/FileBrowserService.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add TreeNode type**

In `src/shared/types.ts`:

```ts
export interface TreeNode {
  name: string;
  path: string; // relative to worktree root, posix separators
  kind: 'file' | 'dir';
  children?: TreeNode[]; // present for dirs (may be empty)
}
```

- [ ] **Step 2: Write failing test**

Create `src/main/services/__tests__/FileBrowserService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { FileBrowserService } from '../FileBrowserService';

function makeWorktree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbs-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.test', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  return dir;
}

describe('FileBrowserService.listTree', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeWorktree();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists tracked + untracked files, hides gitignored ones', async () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\nnode_modules\n');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'a');
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg.js'), 'x');

    const tree = await FileBrowserService.listTree(dir, { showHidden: false });
    const names = collect(tree);
    expect(names).toContain('a.ts');
    expect(names).toContain('.gitignore'); // gitignore itself shows
    expect(names).not.toContain('ignored.txt');
    expect(names).not.toContain('node_modules');
  });

  it('hides dotfiles by default but shows them with showHidden=true', async () => {
    fs.writeFileSync(path.join(dir, '.env'), 'X=1');
    fs.writeFileSync(path.join(dir, 'visible.ts'), '');

    const hidden = await FileBrowserService.listTree(dir, { showHidden: false });
    expect(collect(hidden)).not.toContain('.env');

    const shown = await FileBrowserService.listTree(dir, { showHidden: true });
    expect(collect(shown)).toContain('.env');
  });
});

function collect(tree: { name: string; children?: { name: string }[] }[]): string[] {
  const out: string[] = [];
  const walk = (nodes: typeof tree) => {
    for (const n of nodes) {
      out.push(n.name);
      if (n.children) walk(n.children as typeof tree);
    }
  };
  walk(tree);
  return out;
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm test src/main/services/__tests__/FileBrowserService.test.ts
```

Expected: FAIL — "Cannot find module '../FileBrowserService'".

- [ ] **Step 4: Implement minimal `listTree`**

Create `src/main/services/FileBrowserService.ts`:

```ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import type { TreeNode } from '@shared/types';
import ignore from 'ignore';

const execFileAsync = promisify(execFile);

const ALWAYS_DENY = new Set(['.git', 'node_modules']);

export interface ListTreeOptions {
  showHidden: boolean;
}

export class FileBrowserService {
  static async listTree(worktreeRoot: string, opts: ListTreeOptions): Promise<TreeNode[]> {
    const isGit = fs.existsSync(path.join(worktreeRoot, '.git'));
    const paths = isGit ? await listViaGit(worktreeRoot) : await listViaIgnore(worktreeRoot);
    const filtered = paths.filter((p) => {
      if (!opts.showHidden) {
        const segs = p.split('/');
        if (segs.some((s) => s.startsWith('.') && s !== '.gitignore')) return false;
      }
      const top = p.split('/')[0];
      if (ALWAYS_DENY.has(top)) return false;
      return true;
    });
    return buildTree(filtered);
  }
}

async function listViaGit(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.split('\n').filter(Boolean);
}

async function listViaIgnore(cwd: string): Promise<string[]> {
  const ig = ignore();
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf8'));
  }
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(cwd, rel);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ALWAYS_DENY.has(ent.name)) continue;
      if (ig.ignores(childRel)) continue;
      if (ent.isDirectory()) walk(childRel);
      else out.push(childRel);
    }
  };
  walk('');
  return out;
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const p of paths) {
    const segs = p.split('/');
    let level = root;
    let acc = '';
    for (let i = 0; i < segs.length; i++) {
      const name = segs[i];
      acc = acc ? `${acc}/${name}` : name;
      const isLeaf = i === segs.length - 1;
      let node = level.find((n) => n.name === name);
      if (!node) {
        node = isLeaf
          ? { name, path: acc, kind: 'file' }
          : { name, path: acc, kind: 'dir', children: [] };
        level.push(node);
      }
      if (!isLeaf) level = node.children!;
    }
  }
  // Sort: dirs first, then files, alpha within each
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => n.children && sortRec(n.children));
  };
  sortRec(root);
  return root;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test src/main/services/__tests__/FileBrowserService.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/FileBrowserService.ts src/main/services/__tests__/FileBrowserService.test.ts src/shared/types.ts
git commit -m "Add FileBrowserService.listTree with gitignore support"
```

---

## Task 4: FileBrowserService.readFile (TDD)

**Files:**

- Modify: `src/main/services/FileBrowserService.ts`
- Modify: `src/main/services/__tests__/FileBrowserService.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add return type**

In `src/shared/types.ts`:

```ts
export type ReadFileResult =
  | { kind: 'text'; content: string; bytes: number; truncated: boolean }
  | { kind: 'binary'; bytes: number }
  | {
      kind: 'error';
      reason: 'not_found' | 'too_large' | 'read_failed';
      bytes?: number;
      message?: string;
    };
```

- [ ] **Step 2: Write failing tests**

Append to `FileBrowserService.test.ts`:

```ts
import { Buffer } from 'buffer';

describe('FileBrowserService.readFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeWorktree();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns text for utf-8 files', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;\n');
    const res = await FileBrowserService.readFile(dir, 'a.ts');
    expect(res.kind).toBe('text');
    if (res.kind === 'text') expect(res.content).toBe('export const x = 1;\n');
  });

  it('returns binary marker for PNG signature', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    fs.writeFileSync(path.join(dir, 'img.png'), png);
    const res = await FileBrowserService.readFile(dir, 'img.png');
    expect(res.kind).toBe('binary');
  });

  it('returns too_large for >1MB files (metadata only)', async () => {
    fs.writeFileSync(path.join(dir, 'big.txt'), Buffer.alloc(1024 * 1024 + 10, 'a'));
    const res = await FileBrowserService.readFile(dir, 'big.txt');
    expect(res.kind).toBe('error');
    if (res.kind === 'error') {
      expect(res.reason).toBe('too_large');
      expect(res.bytes).toBeGreaterThan(1024 * 1024);
    }
  });

  it('returns not_found for missing files', async () => {
    const res = await FileBrowserService.readFile(dir, 'nope.ts');
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.reason).toBe('not_found');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
pnpm test src/main/services/__tests__/FileBrowserService.test.ts
```

Expected: 4 new failures — `readFile is not a function`.

- [ ] **Step 4: Implement readFile**

Append to `FileBrowserService.ts` (inside the class):

```ts
  static async readFile(worktreeRoot: string, relPath: string): Promise<import('@shared/types').ReadFileResult> {
    const abs = path.join(worktreeRoot, relPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return { kind: 'error', reason: 'not_found' };
    }
    const bytes = stat.size;
    const MAX = 1024 * 1024;
    if (bytes > MAX) return { kind: 'error', reason: 'too_large', bytes };

    // Sniff first 512 bytes for binary
    let fd: number | null = null;
    try {
      fd = fs.openSync(abs, 'r');
      const head = Buffer.alloc(Math.min(512, bytes));
      fs.readSync(fd, head, 0, head.length, 0);
      if (isBinary(head, relPath)) return { kind: 'binary', bytes };
      const buf = Buffer.alloc(bytes);
      fs.readSync(fd, buf, 0, bytes, 0);
      return { kind: 'text', content: buf.toString('utf8'), bytes, truncated: false };
    } catch (err) {
      return {
        kind: 'error',
        reason: 'read_failed',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
  }
```

Add helper outside the class (top-level in same file):

```ts
const BINARY_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'icns',
  'pdf',
  'zip',
  'gz',
  'tar',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'exe',
  'dll',
  'so',
  'dylib',
  'a',
  'o',
  'mp3',
  'mp4',
  'mov',
  'wav',
  'ogg',
  'webm',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'wasm',
]);

function isBinary(head: Buffer, relPath: string): boolean {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  if (BINARY_EXTS.has(ext)) return true;
  // NUL byte heuristic
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return true;
  return false;
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test src/main/services/__tests__/FileBrowserService.test.ts
```

Expected: PASS (6 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/FileBrowserService.ts src/main/services/__tests__/FileBrowserService.test.ts src/shared/types.ts
git commit -m "Add FileBrowserService.readFile with binary/large guards"
```

---

## Task 5: FileBrowserService watcher (chokidar)

**Files:**

- Modify: `src/main/services/FileBrowserService.ts`
- Modify: `src/main/services/__tests__/FileBrowserService.test.ts`

- [ ] **Step 1: Write failing test**

Append to `FileBrowserService.test.ts`:

```ts
describe('FileBrowserService watcher', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeWorktree();
  });
  afterEach(async () => {
    await FileBrowserService.unwatch('test-task');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('emits fileChanged when a watched file is written', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'v1');
    const events: string[] = [];
    await FileBrowserService.watch('test-task', dir, {
      onFileChanged: (p) => events.push(p),
      onTreeChanged: () => {},
    });
    await new Promise((r) => setTimeout(r, 200)); // chokidar settle
    fs.writeFileSync(path.join(dir, 'a.ts'), 'v2');
    await new Promise((r) => setTimeout(r, 250));
    expect(events).toContain('a.ts');
  });

  it('emits treeChanged when a file is added', async () => {
    let treeEvents = 0;
    await FileBrowserService.watch('test-task', dir, {
      onFileChanged: () => {},
      onTreeChanged: () => {
        treeEvents++;
      },
    });
    await new Promise((r) => setTimeout(r, 200));
    fs.writeFileSync(path.join(dir, 'new.ts'), '');
    await new Promise((r) => setTimeout(r, 350));
    expect(treeEvents).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test src/main/services/__tests__/FileBrowserService.test.ts -t watcher
```

Expected: FAIL — `watch is not a function`.

- [ ] **Step 3: Implement watcher**

Add to `FileBrowserService.ts`:

```ts
import chokidar, { type FSWatcher } from 'chokidar';

interface WatcherEntry {
  watcher: FSWatcher;
  fileTimer: ReturnType<typeof setTimeout> | null;
  fileQueue: Set<string>;
  treeTimer: ReturnType<typeof setTimeout> | null;
  treeDirty: boolean;
  cb: WatchCallbacks;
}

export interface WatchCallbacks {
  onFileChanged: (relPath: string) => void;
  onTreeChanged: () => void;
}

const watchers = new Map<string, WatcherEntry>();

const FILE_DEBOUNCE_MS = 50;
const TREE_DEBOUNCE_MS = 200;
```

Then add static methods to the class:

```ts
  static async watch(taskId: string, worktreeRoot: string, cb: WatchCallbacks): Promise<void> {
    if (watchers.has(taskId)) await FileBrowserService.unwatch(taskId);

    const watcher = chokidar.watch(worktreeRoot, {
      ignored: (p: string) => {
        const rel = path.relative(worktreeRoot, p);
        if (!rel) return false;
        const top = rel.split(path.sep)[0];
        return ALWAYS_DENY.has(top);
      },
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 20 },
    });

    const entry: WatcherEntry = {
      watcher,
      fileTimer: null,
      fileQueue: new Set(),
      treeTimer: null,
      treeDirty: false,
      cb,
    };
    watchers.set(taskId, entry);

    const flushFiles = () => {
      const paths = Array.from(entry.fileQueue);
      entry.fileQueue.clear();
      entry.fileTimer = null;
      paths.forEach((p) => entry.cb.onFileChanged(p));
    };
    const flushTree = () => {
      entry.treeDirty = false;
      entry.treeTimer = null;
      entry.cb.onTreeChanged();
    };

    const queueFile = (abs: string) => {
      const rel = path.relative(worktreeRoot, abs).split(path.sep).join('/');
      entry.fileQueue.add(rel);
      if (entry.fileTimer) clearTimeout(entry.fileTimer);
      entry.fileTimer = setTimeout(flushFiles, FILE_DEBOUNCE_MS);
    };

    const treeEvent = () => {
      entry.treeDirty = true;
      if (entry.treeTimer) clearTimeout(entry.treeTimer);
      entry.treeTimer = setTimeout(flushTree, TREE_DEBOUNCE_MS);
    };

    watcher.on('change', queueFile);
    // unlink fires both fileChanged (so open FilePanes re-fetch and land in not_found)
    // and treeChanged (so the tree updates)
    watcher.on('unlink', (abs) => {
      queueFile(abs);
      treeEvent();
    });
    watcher.on('add', treeEvent);
    watcher.on('addDir', treeEvent);
    watcher.on('unlinkDir', treeEvent);

    watcher.on('error', () => {
      // chokidar will keep going for most errors; on EMFILE the caller can re-watch
    });

    await new Promise<void>((resolve) => watcher.on('ready', () => resolve()));
  }

  static async unwatch(taskId: string): Promise<void> {
    const entry = watchers.get(taskId);
    if (!entry) return;
    if (entry.fileTimer) clearTimeout(entry.fileTimer);
    if (entry.treeTimer) clearTimeout(entry.treeTimer);
    await entry.watcher.close();
    watchers.delete(taskId);
  }

  static async unwatchAll(): Promise<void> {
    await Promise.all(Array.from(watchers.keys()).map((id) => FileBrowserService.unwatch(id)));
  }
```

- [ ] **Step 4: Run watcher tests**

```bash
pnpm test src/main/services/__tests__/FileBrowserService.test.ts -t watcher
```

Expected: PASS (2 tests). If flaky on slow CI, increase the `setTimeout(..., 250)` to 500.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/FileBrowserService.ts src/main/services/__tests__/FileBrowserService.test.ts
git commit -m "Add chokidar-based watcher to FileBrowserService"
```

---

## Task 6: IPC handlers (fileBrowser + openFiles)

**Files:**

- Create: `src/main/ipc/fileBrowserIpc.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/shared/types.ts` (if `IpcResponse` not yet generic-friendly — verify)

- [ ] **Step 1: Implement IPC module**

Create `src/main/ipc/fileBrowserIpc.ts`:

```ts
import { ipcMain, BrowserWindow } from 'electron';
import { FileBrowserService } from '../services/FileBrowserService';
import { openFilesQueries } from '../db/openFiles';
import { getRawDb } from '../db/client';
import type { IpcResponse, TreeNode, ReadFileResult, OpenFileRow } from '@shared/types';

function ok<T>(data: T): IpcResponse<T> {
  return { success: true, data };
}
function err(message: string): IpcResponse<never> {
  return { success: false, error: message };
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

function getTaskCwd(taskId: string): string | null {
  const db = getRawDb();
  if (!db) return null;
  const row = db.prepare(`SELECT path FROM tasks WHERE id = ?`).get(taskId) as
    | { path: string }
    | undefined;
  return row?.path ?? null;
}

export function registerFileBrowserIpc(): void {
  ipcMain.handle(
    'fileBrowser:listTree',
    async (_e, args: { taskId: string; showHidden: boolean }): Promise<IpcResponse<TreeNode[]>> => {
      const cwd = getTaskCwd(args.taskId);
      if (!cwd) return err('task not found');
      try {
        return ok(await FileBrowserService.listTree(cwd, { showHidden: args.showHidden }));
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  ipcMain.handle(
    'fileBrowser:readFile',
    async (
      _e,
      args: { taskId: string; filePath: string },
    ): Promise<IpcResponse<ReadFileResult>> => {
      const cwd = getTaskCwd(args.taskId);
      if (!cwd) return err('task not found');
      return ok(await FileBrowserService.readFile(cwd, args.filePath));
    },
  );

  ipcMain.handle(
    'fileBrowser:watch',
    async (_e, args: { taskId: string }): Promise<IpcResponse<null>> => {
      const cwd = getTaskCwd(args.taskId);
      if (!cwd) return err('task not found');
      try {
        await FileBrowserService.watch(args.taskId, cwd, {
          onFileChanged: (p) => broadcast(`fileBrowser:fileChanged:${args.taskId}`, p),
          onTreeChanged: () => broadcast(`fileBrowser:treeChanged:${args.taskId}`, null),
        });
        return ok(null);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  ipcMain.handle('fileBrowser:unwatch', async (_e, args: { taskId: string }) => {
    await FileBrowserService.unwatch(args.taskId);
    return ok(null);
  });

  ipcMain.handle('openFiles:list', (_e, args: { taskId: string }): IpcResponse<OpenFileRow[]> => {
    return ok(openFilesQueries.list(args.taskId));
  });
  ipcMain.handle(
    'openFiles:add',
    (_e, args: { taskId: string; filePath: string }): IpcResponse<OpenFileRow> => {
      return ok(openFilesQueries.add(args.taskId, args.filePath));
    },
  );
  ipcMain.handle(
    'openFiles:remove',
    (_e, args: { taskId: string; filePath: string }): IpcResponse<null> => {
      openFilesQueries.remove(args.taskId, args.filePath);
      return ok(null);
    },
  );
  ipcMain.handle(
    'openFiles:reorder',
    (_e, args: { taskId: string; paths: string[] }): IpcResponse<null> => {
      openFilesQueries.reorder(args.taskId, args.paths);
      return ok(null);
    },
  );
}
```

- [ ] **Step 2: Register IPC**

Edit `src/main/ipc/index.ts`:

```ts
import { registerFileBrowserIpc } from './fileBrowserIpc';
// ...inside registerAllIpc():
registerFileBrowserIpc();
```

- [ ] **Step 3: Type-check**

```bash
pnpm type-check
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/fileBrowserIpc.ts src/main/ipc/index.ts
git commit -m "Add fileBrowser/openFiles IPC handlers"
```

---

## Task 7: Preload + electron-api types

**Files:**

- Modify: `src/main/preload.ts`
- Modify: `src/types/electron-api.d.ts`

- [ ] **Step 1: Extend preload**

In `src/main/preload.ts`, inside `contextBridge.exposeInMainWorld('electronAPI', { ... })`, add:

```ts
  // File browser
  fileBrowserListTree: (args: { taskId: string; showHidden: boolean }) =>
    ipcRenderer.invoke('fileBrowser:listTree', args),
  fileBrowserReadFile: (args: { taskId: string; filePath: string }) =>
    ipcRenderer.invoke('fileBrowser:readFile', args),
  fileBrowserWatch: (args: { taskId: string }) => ipcRenderer.invoke('fileBrowser:watch', args),
  fileBrowserUnwatch: (args: { taskId: string }) =>
    ipcRenderer.invoke('fileBrowser:unwatch', args),
  onFileBrowserFileChanged: (taskId: string, cb: (relPath: string) => void) => {
    const ch = `fileBrowser:fileChanged:${taskId}`;
    const handler = (_e: unknown, p: string) => cb(p);
    ipcRenderer.on(ch, handler);
    return () => ipcRenderer.removeListener(ch, handler);
  },
  onFileBrowserTreeChanged: (taskId: string, cb: () => void) => {
    const ch = `fileBrowser:treeChanged:${taskId}`;
    const handler = () => cb();
    ipcRenderer.on(ch, handler);
    return () => ipcRenderer.removeListener(ch, handler);
  },

  // Open files
  openFilesList: (taskId: string) => ipcRenderer.invoke('openFiles:list', { taskId }),
  openFilesAdd: (args: { taskId: string; filePath: string }) =>
    ipcRenderer.invoke('openFiles:add', args),
  openFilesRemove: (args: { taskId: string; filePath: string }) =>
    ipcRenderer.invoke('openFiles:remove', args),
  openFilesReorder: (args: { taskId: string; paths: string[] }) =>
    ipcRenderer.invoke('openFiles:reorder', args),
```

- [ ] **Step 2: Extend electron-api types**

In `src/types/electron-api.d.ts`, import `TreeNode`, `ReadFileResult`, `OpenFileRow`, then add to the `ElectronAPI` interface:

```ts
  fileBrowserListTree: (args: {
    taskId: string;
    showHidden: boolean;
  }) => Promise<IpcResponse<TreeNode[]>>;
  fileBrowserReadFile: (args: {
    taskId: string;
    filePath: string;
  }) => Promise<IpcResponse<ReadFileResult>>;
  fileBrowserWatch: (args: { taskId: string }) => Promise<IpcResponse<null>>;
  fileBrowserUnwatch: (args: { taskId: string }) => Promise<IpcResponse<null>>;
  onFileBrowserFileChanged: (taskId: string, cb: (relPath: string) => void) => () => void;
  onFileBrowserTreeChanged: (taskId: string, cb: () => void) => () => void;

  openFilesList: (taskId: string) => Promise<IpcResponse<OpenFileRow[]>>;
  openFilesAdd: (args: {
    taskId: string;
    filePath: string;
  }) => Promise<IpcResponse<OpenFileRow>>;
  openFilesRemove: (args: { taskId: string; filePath: string }) => Promise<IpcResponse<null>>;
  openFilesReorder: (args: {
    taskId: string;
    paths: string[];
  }) => Promise<IpcResponse<null>>;
```

- [ ] **Step 3: Type-check**

```bash
pnpm type-check
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.ts src/types/electron-api.d.ts
git commit -m "Expose fileBrowser/openFiles APIs through preload"
```

---

## Task 8: Extend Pane discriminated union

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Update the `Pane` type**

Find the existing line in `src/shared/types.ts`:

```ts
export type Pane = { kind: 'task'; taskId: string } | { kind: 'scratch'; id: string; cwd: string };
```

Replace with:

```ts
export type Pane =
  | { kind: 'task'; taskId: string }
  | { kind: 'scratch'; id: string; cwd: string }
  | { kind: 'file'; taskId: string; filePath: string };
```

- [ ] **Step 2: Type-check (expect failures)**

```bash
pnpm type-check
```

Expected: errors in `PaneShell.tsx`, `TerminalPaneGroup.tsx`, `panes/derived.ts` — switch statements not handling `'file'`. These will be fixed in Tasks 9 / 11.

- [ ] **Step 3: Commit (broken-build commit, intentional small)**

```bash
git add src/shared/types.ts
git commit -m "Add file pane kind to Pane union"
```

(Note: leaving the build red briefly is acceptable here since the next two tasks fix it — alternative: combine Tasks 8/9/11 into one commit.)

---

## Task 9: FilePane component

**Files:**

- Create: `src/renderer/components/FilePane.tsx`

- [ ] **Step 1: Implement FilePane**

```tsx
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
      setMeta(res.data);
      setStale(false);
    }
  };

  useEffect(() => {
    reload();
    const off = window.electronAPI.onFileBrowserFileChanged(taskId, (p) => {
      if (p === filePath) reload();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, filePath]);

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
        <IconButton onClick={onClose} aria-label="Close file">
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
            <div>File too large to preview ({(meta.bytes! / 1024 / 1024).toFixed(1)} MB).</div>
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
```

- [ ] **Step 2: Type-check**

```bash
pnpm type-check
```

Expected: clean for this file (PaneShell still red — fixed in Task 10).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/FilePane.tsx
git commit -m "Add FilePane with editor seam and live updates"
```

---

## Task 10: Wire FilePane into PaneShell + derived

**Files:**

- Modify: `src/renderer/components/PaneShell.tsx`
- Modify: `src/renderer/panes/derived.ts`

- [ ] **Step 1: Update PaneShell**

Open `src/renderer/components/PaneShell.tsx`. Find the switch on `pane.kind`. Add a case:

```tsx
if (pane.kind === 'file') {
  // taskCwd is looked up by the parent (App.tsx) from the task record and passed into PaneShell.
  return (
    <FilePane
      taskId={pane.taskId}
      cwd={taskCwd}
      filePath={pane.filePath}
      onClose={() => onClosePane?.(pane)}
    />
  );
}
```

Add the import at top:

```tsx
import { FilePane } from './FilePane';
```

(Read the file first. Match the existing close-handler prop name. Add `taskCwd: string` to `PaneShell` props if not already present; thread from `App.tsx` via the active task's `path`.)

- [ ] **Step 2: Update derived.ts**

Open `src/renderer/panes/derived.ts`. Find the function that builds the `Pane[]` array. Add a step that appends file panes from the `open_files` table for the active task. Approach:

```ts
import type { Pane, OpenFileRow } from '@shared/types';

export function withOpenFiles(panes: Pane[], openFiles: OpenFileRow[]): Pane[] {
  return [
    ...panes,
    ...openFiles.map<Pane>((f) => ({ kind: 'file', taskId: f.taskId, filePath: f.filePath })),
  ];
}
```

(Or thread it through whatever derivation function already exists — the goal is that file panes appear in the pane list when there are rows in `open_files` for the active task.)

- [ ] **Step 3: Type-check + tests**

```bash
pnpm type-check
pnpm test src/renderer/panes/__tests__
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/PaneShell.tsx src/renderer/panes/derived.ts
git commit -m "Render FilePane for file panes; derive from open_files"
```

---

## Task 11: FileTree component

**Files:**

- Create: `src/renderer/components/FileTree.tsx`

- [ ] **Step 1: Implement FileTree**

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Eye, EyeOff } from 'lucide-react';
import type { TreeNode } from '@shared/types';

interface FileTreeProps {
  taskId: string | null;
  onOpenFile: (filePath: string) => void;
}

export function FileTree({ taskId, onOpenFile }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    return localStorage.getItem('fileTree:showHidden') === '1';
  });

  const reload = useCallback(async () => {
    if (!taskId) {
      setTree([]);
      return;
    }
    const res = await window.electronAPI.fileBrowserListTree({ taskId, showHidden });
    if (res.success) setTree(res.data);
  }, [taskId, showHidden]);

  useEffect(() => {
    reload();
    if (!taskId) return;
    const off = window.electronAPI.onFileBrowserTreeChanged(taskId, () => {
      reload();
    });
    return off;
  }, [taskId, reload]);

  useEffect(() => {
    localStorage.setItem('fileTree:showHidden', showHidden ? '1' : '0');
  }, [showHidden]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (!taskId) {
    return (
      <div className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
        Select a task to browse files.
      </div>
    );
  }

  return (
    <div className="flex flex-col text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[hsl(var(--border))]">
        <span className="text-[hsl(var(--muted-foreground))] uppercase tracking-wide text-[10px]">
          Files
        </span>
        <button
          className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          onClick={() => setShowHidden((v) => !v)}
          title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
        >
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="overflow-auto py-1">
        {tree.map((n) => (
          <Node
            key={n.path}
            node={n}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}

function Node({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (filePath: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const indent = { paddingLeft: 4 + depth * 12 };

  if (node.kind === 'dir') {
    return (
      <>
        <div
          style={indent}
          onClick={() => onToggle(node.path)}
          className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-[hsl(var(--surface-1))]"
        >
          {isOpen ? (
            <ChevronDown className="w-3 h-3 stroke-[1.8]" />
          ) : (
            <ChevronRight className="w-3 h-3 stroke-[1.8]" />
          )}
          {isOpen ? (
            <FolderOpen className="w-3.5 h-3.5 stroke-[1.8]" />
          ) : (
            <Folder className="w-3.5 h-3.5 stroke-[1.8]" />
          )}
          <span>{node.name}</span>
        </div>
        {isOpen &&
          node.children?.map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
      </>
    );
  }

  return (
    <div
      style={indent}
      onClick={() => onOpenFile(node.path)}
      className="flex items-center gap-1 py-0.5 pl-4 cursor-pointer hover:bg-[hsl(var(--surface-1))]"
    >
      <FileText className="w-3.5 h-3.5 stroke-[1.8] text-[hsl(var(--muted-foreground))]" />
      <span>{node.name}</span>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm type-check
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/FileTree.tsx
git commit -m "Add FileTree component with lazy expand and dotfiles toggle"
```

---

## Task 12: Integrate FileTree into LeftSidebar

**Files:**

- Modify: `src/renderer/components/LeftSidebar.tsx`

- [ ] **Step 1: Read LeftSidebar.tsx to find the section anchor**

```bash
grep -n "RotationSection\|export function LeftSidebar\|Tasks\|Projects" src/renderer/components/LeftSidebar.tsx | head
```

- [ ] **Step 2: Add a collapsible Files section beneath the rotation/tasks section**

Add `import { FileTree } from './FileTree';` at top.

Add a new collapsible block after the existing Rotation/Tasks section. Visibility persisted in localStorage:

```tsx
const [filesOpen, setFilesOpen] = useState<boolean>(
  () => localStorage.getItem('leftSidebar:filesOpen') !== '0',
);

useEffect(() => {
  localStorage.setItem('leftSidebar:filesOpen', filesOpen ? '1' : '0');
}, [filesOpen]);
```

Render section (placed after tasks):

```tsx
<div className="border-t border-[hsl(var(--border))]">
  <button
    onClick={() => setFilesOpen((v) => !v)}
    className="w-full px-3 py-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]"
  >
    {filesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
    Files
  </button>
  {filesOpen && (
    <div className="max-h-80 overflow-auto">
      <FileTree taskId={activeTaskId} onOpenFile={(p) => onOpenFilePane(activeTaskId!, p)} />
    </div>
  )}
</div>
```

(Pass `activeTaskId` and a new prop `onOpenFilePane` from `App.tsx` — see Task 13.)

Add to `LeftSidebarProps` interface:

```ts
activeTaskId: string | null;
onOpenFilePane: (taskId: string, filePath: string) => void;
```

- [ ] **Step 3: Type-check**

```bash
pnpm type-check
```

Expected: error on App.tsx not passing `onOpenFilePane` — fix in Task 13.

- [ ] **Step 4: Commit (yes, even with App.tsx red — fixed next)**

```bash
git add src/renderer/components/LeftSidebar.tsx
git commit -m "Add Files section to LeftSidebar"
```

---

## Task 13: Wire watch lifecycle + open-file actions in App.tsx

**Files:**

- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add watch lifecycle effect**

In `App.tsx`, near other task-switch effects, add:

```tsx
useEffect(() => {
  if (!activeTaskId) return;
  window.electronAPI.fileBrowserWatch({ taskId: activeTaskId });
  return () => {
    window.electronAPI.fileBrowserUnwatch({ taskId: activeTaskId });
  };
}, [activeTaskId]);
```

- [ ] **Step 2: Add open-files state hydration**

```tsx
const [openFilesByTask, setOpenFilesByTask] = useState<Record<string, OpenFileRow[]>>({});

useEffect(() => {
  if (!activeTaskId) return;
  let cancelled = false;
  window.electronAPI.openFilesList(activeTaskId).then((res) => {
    if (cancelled || !res.success) return;
    setOpenFilesByTask((prev) => ({ ...prev, [activeTaskId]: res.data }));
  });
  return () => {
    cancelled = true;
  };
}, [activeTaskId]);
```

- [ ] **Step 3: Add open/close handlers**

```tsx
const handleOpenFilePane = useCallback(async (taskId: string, filePath: string) => {
  const res = await window.electronAPI.openFilesAdd({ taskId, filePath });
  if (!res.success) return;
  setOpenFilesByTask((prev) => {
    const cur = prev[taskId] ?? [];
    if (cur.some((f) => f.filePath === filePath)) return prev;
    return { ...prev, [taskId]: [...cur, res.data] };
  });
}, []);

const handleCloseFilePane = useCallback(async (taskId: string, filePath: string) => {
  await window.electronAPI.openFilesRemove({ taskId, filePath });
  setOpenFilesByTask((prev) => {
    const cur = prev[taskId] ?? [];
    return { ...prev, [taskId]: cur.filter((f) => f.filePath !== filePath) };
  });
}, []);
```

- [ ] **Step 4: Pass through to LeftSidebar and pane derivation**

- Pass `activeTaskId={activeTaskId}` and `onOpenFilePane={handleOpenFilePane}` to `<LeftSidebar>`.
- Where panes are derived for the active task, append the open file panes (using the `withOpenFiles` helper from Task 10), and route close events to `handleCloseFilePane`.

(Read the existing pane-derivation site and adapt; the goal is `Pane[]` rendered by `TerminalPaneGroup` includes `{ kind: 'file', taskId, filePath }` entries when `openFilesByTask[activeTaskId]` is non-empty.)

- [ ] **Step 5: Run app, smoke**

```bash
pnpm dev
```

Verify:

1. App starts.
2. Selecting a task shows the Files section in `LeftSidebar` populated.
3. Clicking a file opens a `FilePane` in `TerminalPaneGroup`.
4. Closing the pane via the X removes it.
5. Restart app, the previously-open file is still there.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "Wire file watcher lifecycle and open-files state in App"
```

---

## Task 14: Manual smoke test pass

**Files:** none.

- [ ] **Step 1: Run the smoke checklist from the spec**

Start the app:

```bash
pnpm dev
```

Tick each:

1. [ ] Open a task → tree appears, gitignored paths absent.
2. [ ] Click a file → pane opens, Shiki renders syntax-highlighted content.
3. [ ] From a terminal pane in the same task, run `echo foo >> README.md` (or some tracked file) → the open file pane updates within ~250 ms.
4. [ ] In a terminal: `touch new.ts && rm new.ts` → tree shows then removes the entry.
5. [ ] Switch to another task → previous file panes disappear, new task's panes hydrate.
6. [ ] Switch back → original file panes return.
7. [ ] Restart app (`Cmd+Q`, relaunch) → open panes for the active task survive.
8. [ ] In a terminal: `rm` an open file → pane shows "deleted on disk", no crash.
9. [ ] Toggle dotfiles in `FileTree` header → `.env`-like files appear/disappear.
10. [ ] Open a 5 MB log file (`dd if=/dev/zero of=big.log bs=1m count=5` from a terminal in the worktree, then click it in the tree) → "too large to preview" + "Open in IDE" works.

- [ ] **Step 2: Fix any issues** discovered, commit each as a separate fix.

- [ ] **Step 3: Final type-check and unit-test pass**

```bash
pnpm type-check
pnpm test
```

Expected: clean across the board.

- [ ] **Step 4: Final commit if any docstring or comment cleanup**

```bash
git add -A
git commit -m "Polish file tree and open files smoke fixes"
```

---

## Done

Feature is complete and matches the spec. Out-of-scope items (file editing, search/find-in-files, drag-drop file moves, context menus, git status decoration on tree nodes) intentionally not implemented in v1.

**Implemented but UI-deferred:** `openFiles:reorder` IPC + DB query is wired (Tasks 2, 6, 7) so a future task can add drag-to-reorder for file panes without backend changes. v1 ships with insertion-order panes only — sufficient for most usage.
