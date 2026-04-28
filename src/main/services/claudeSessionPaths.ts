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

/**
 * Return the absolute path to the most recently modified `.jsonl` in the cwd's
 * Claude project dir, or null if there are none. Used as a fallback when a task
 * doesn't have a captured `lastSessionId` yet (e.g. legacy tasks or sessions
 * started before the SessionStart hook was wired up).
 */
export function getLatestSessionJsonlPath(cwd: string): string | null {
  const projDir = findClaudeProjectDir(cwd);
  if (!projDir) return null;
  try {
    const entries = fs
      .readdirSync(projDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(projDir, f);
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return entries[0]?.full ?? null;
  } catch {
    return null;
  }
}
