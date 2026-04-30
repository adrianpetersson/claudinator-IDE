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
    await new Promise((r) => setTimeout(r, 200));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'v2');
    await new Promise((r) => setTimeout(r, 400));
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
    await new Promise((r) => setTimeout(r, 500));
    expect(treeEvents).toBeGreaterThan(0);
  });

  it('emits BOTH fileChanged and treeChanged when a file is unlinked', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'v1');
    const fileEvents: string[] = [];
    let treeEvents = 0;
    await FileBrowserService.watch('test-task', dir, {
      onFileChanged: (p) => fileEvents.push(p),
      onTreeChanged: () => {
        treeEvents++;
      },
    });
    await new Promise((r) => setTimeout(r, 200));
    fs.unlinkSync(path.join(dir, 'a.ts'));
    await new Promise((r) => setTimeout(r, 400));
    expect(fileEvents).toContain('a.ts');
    expect(treeEvents).toBeGreaterThan(0);
  });
});
