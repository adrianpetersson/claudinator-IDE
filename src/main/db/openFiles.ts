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
