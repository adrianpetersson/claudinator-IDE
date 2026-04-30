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
