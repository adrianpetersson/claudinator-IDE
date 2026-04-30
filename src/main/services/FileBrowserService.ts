import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';
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

  static async readFile(
    worktreeRoot: string,
    relPath: string,
  ): Promise<import('@shared/types').ReadFileResult> {
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
}

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
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return true;
  return false;
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
