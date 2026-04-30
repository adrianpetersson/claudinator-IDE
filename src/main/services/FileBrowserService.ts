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
