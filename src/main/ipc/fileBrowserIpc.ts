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

  ipcMain.handle(
    'fileBrowser:unwatch',
    async (_e, args: { taskId: string }): Promise<IpcResponse<null>> => {
      await FileBrowserService.unwatch(args.taskId);
      return ok(null);
    },
  );

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
