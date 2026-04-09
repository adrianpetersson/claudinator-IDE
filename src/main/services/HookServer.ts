import * as http from 'http';
import { BrowserWindow, Notification } from 'electron';
import { eq } from 'drizzle-orm';
import { activityMonitor } from './ActivityMonitor';
import { contextUsageService } from './ContextUsageService';
import { getDb } from '../db/client';
import { tasks } from '../db/schema';

class HookServerImpl {
  private server: http.Server | null = null;
  private _port: number = 0;
  private _desktopNotificationEnabled = false;

  get port(): number {
    return this._port;
  }

  setDesktopNotification(opts: { enabled: boolean }): void {
    this._desktopNotificationEnabled = opts.enabled;
  }

  private showDesktopNotification(ptyId: string, body?: string): void {
    if (!this._desktopNotificationEnabled) return;

    // Skip if the app window is focused — user is already looking at it
    const win = BrowserWindow.getAllWindows()[0];
    if (win && win.isFocused()) return;

    try {
      if (!body) {
        body = 'A task finished';
        try {
          const db = getDb();
          const task = db.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, ptyId)).get();
          if (task?.name) {
            body = `${task.name} finished`;
          }
        } catch {
          // DB lookup failed — use fallback
        }
      }
      const n = new Notification({
        title: 'Dash',
        body,
      });
      n.on('click', () => {
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
          win.webContents.send('app:focusTask', ptyId);
        }
      });
      n.show();
    } catch (err) {
      console.error('[HookServer] Failed to show notification:', err);
    }
  }

  private getTaskName(ptyId: string): string {
    try {
      const db = getDb();
      const task = db.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, ptyId)).get();
      return task?.name || 'A task';
    } catch {
      return 'A task';
    }
  }

  /** Read and parse a JSON POST body, enforcing a size limit. */
  private readJsonBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    callback: (data: Record<string, unknown>) => void,
  ): void {
    let body = '';
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > maxBytes) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (overflow) {
        res.writeHead(413);
        res.end('payload too large');
        return;
      }
      try {
        callback(JSON.parse(body));
      } catch (err) {
        console.error('[HookServer] Failed to parse JSON body:', err);
        res.writeHead(400);
        res.end('bad request');
      }
    });
  }

  async start(): Promise<number> {
    if (this.server) return this._port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${this._port}`);
        const ptyId = url.searchParams.get('ptyId');

        if (!ptyId) {
          res.writeHead(400);
          res.end('missing ptyId');
          return;
        }

        const pathname = url.pathname;

        // All hooks are POST — drain the JSON body before responding.
        // IMPORTANT: Response must have an empty body (not 'ok') to avoid
        // injecting text into Claude's conversation context.

        if (pathname === '/hook/stop') {
          this.readJsonBody(req, res, 65_536, () => {
            activityMonitor.setIdle(ptyId);
            this.showDesktopNotification(ptyId);
            res.writeHead(200);
            res.end();
          });
          return;
        }

        if (pathname === '/hook/busy') {
          this.readJsonBody(req, res, 65_536, () => {
            activityMonitor.setBusy(ptyId);
            res.writeHead(200);
            res.end();
          });
          return;
        }

        if (pathname === '/hook/notification') {
          this.readJsonBody(req, res, 65_536, (payload) => {
            const notificationType = payload.notification_type as string;
            const message = payload.message as string | undefined;

            if (notificationType === 'permission_prompt') {
              activityMonitor.setWaitingForPermission(ptyId);
              const taskName = this.getTaskName(ptyId);
              const notifBody = message
                ? `${taskName}: ${message}`
                : `${taskName} needs permission`;
              this.showDesktopNotification(ptyId, notifBody);
            } else if (notificationType === 'idle_prompt') {
              activityMonitor.setIdle(ptyId);
              this.showDesktopNotification(ptyId);
            }

            res.writeHead(200);
            res.end();
          });
          return;
        }

        // StatusLine — context usage data (from curl command, not a hook)
        if (pathname === '/hook/context') {
          this.readJsonBody(req, res, 65_536, (data) => {
            contextUsageService.updateFromStatusLine(ptyId, data);
            activityMonitor.noteStatusLine(ptyId);
            res.writeHead(200);
            res.end();
          });
          return;
        }

        if (pathname === '/hook/tool-start') {
          this.readJsonBody(req, res, 65_536, (payload) => {
            const toolName = (payload.tool_name as string) || 'unknown';
            const toolInput = payload.tool_input as Record<string, unknown> | undefined;
            activityMonitor.setToolStart(ptyId, toolName, toolInput);
            res.writeHead(200);
            res.end();
          });
          return;
        }

        if (pathname === '/hook/tool-end') {
          this.readJsonBody(req, res, 65_536, () => {
            activityMonitor.setToolEnd(ptyId);
            res.writeHead(200);
            res.end();
          });
          return;
        }

        if (pathname === '/hook/stop-failure') {
          this.readJsonBody(req, res, 65_536, (payload) => {
            const errorType = (payload.error_type as string) || 'unknown';
            const message = payload.error as string | undefined;
            console.error(`[HookServer] StopFailure for ptyId=${ptyId} type=${errorType}`);
            activityMonitor.setError(ptyId, errorType, message);

            if (errorType === 'rate_limit') {
              const taskName = this.getTaskName(ptyId);
              this.showDesktopNotification(ptyId, `${taskName} hit rate limit`);
            }

            res.writeHead(200);
            res.end();
          });
          return;
        }

        if (pathname === '/hook/compact-start') {
          this.readJsonBody(req, res, 65_536, () => {
            activityMonitor.setCompacting(ptyId, true);
            res.writeHead(200);
            res.end();
          });
          return;
        }

        if (pathname === '/hook/compact-end') {
          this.readJsonBody(req, res, 65_536, () => {
            activityMonitor.setCompacting(ptyId, false);
            res.writeHead(200);
            res.end();
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
          console.error(`[HookServer] Listening on 127.0.0.1:${this._port}`);
          resolve(this._port);
        } else {
          reject(new Error('Failed to get hook server address'));
        }
      });

      this.server.on('error', reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this._port = 0;
    }
  }
}

export const hookServer = new HookServerImpl();
