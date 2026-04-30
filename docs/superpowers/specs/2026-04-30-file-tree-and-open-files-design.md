# File Tree & Open Files — Design

**Status:** Approved (design)
**Date:** 2026-04-30
**Owner:** Adrian

## Goal

Add a per-task file tree and an "open files" pane kind to Claudinator so the user can browse the active task's worktree and view files alongside the running Claude Code session — without leaving the app.

This is **view-only** for v1, with an explicit editor seam so a real editor (Monaco/CodeMirror) can drop in later without rewriting the surface.

## Non-goals

- File editing (v1 is read-only; the body slot in `FilePane` is designed to be replaceable).
- File search / find-in-files.
- Drag-and-drop moves, rename/delete/new-file context menus.
- Per-node git status decoration on tree entries (`FileChangesPanel` already covers git review/staging).
- Browsing the main project (non-worktree) source. Out of scope; user can use their real editor.

## Decisions (locked)

| #   | Decision               | Chosen                                                                                        | Rationale                                                                                                 |
| --- | ---------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Editing scope          | View-only with editor seam                                                                    | Match Claudinator's "supervise Claude" identity; keep surface light; don't compete with Cursor            |
| 2   | Tree scope             | Per-task (worktree)                                                                           | Consistent with terminal/git-status/file-changes which are all per-task                                   |
| 3   | Layout                 | File tree as section in `LeftSidebar`; files open as a new `Pane` kind in `TerminalPaneGroup` | Keeps navigation in the existing nav column; reuses pane infrastructure; doesn't crowd `FileChangesPanel` |
| 4   | Hidden/ignored         | Respect `.gitignore` + hide dotfiles by default; toggle to show                               | Matches every editor; cheap; performance win on large repos                                               |
| 5   | Open-files persistence | Per-task, persisted to SQLite                                                                 | Paths only make sense inside a worktree; restore on app restart                                           |
| 6   | Live updates           | chokidar file watcher on the active task's worktree                                           | Live updates are the point of the feature                                                                 |

## Architecture

Three layers, all task-scoped:

1. **Main process — `FileBrowserService`** (singleton, static methods, matching existing service style). Owns gitignore-aware tree walks, file-content reads, and per-task chokidar watchers. One watcher per _active_ task; tasks not on screen are unwatched.

2. **IPC layer — `src/main/ipc/fileBrowser.ts`** with `IpcResponse<T>` request/response handlers and two push channels:
   - Request/response (4): `fileBrowser:listTree`, `fileBrowser:readFile`, `fileBrowser:watch`, `fileBrowser:unwatch`
   - Request/response (4, open-files persistence): `openFiles:list`, `openFiles:add`, `openFiles:remove`, `openFiles:reorder`
   - Push events: `fileBrowser:treeChanged`, `fileBrowser:fileChanged`

3. **Renderer**:
   - `FileTree.tsx` — collapsible section in `LeftSidebar` below tasks. Lazy-expanding directories. `.gitignore`-aware. Dotfiles toggle.
   - `FilePane.tsx` — new pane kind. Header (path + close), body slot rendering existing `FileView` (Shiki). The body slot is the **editor seam**: a single component swap when an editor is added.
   - `Pane` discriminated union extended: `{ kind: 'file'; taskId: string; filePath: string }`. `PaneShell` / `TerminalPaneGroup` dispatch on `kind`.

## Components

### Main process

- `src/main/services/fileBrowser.ts`
  - `listTree(taskId, opts: { showHidden: boolean }) → TreeNode[]` — walks the worktree. Primary impl uses `git ls-files --cached --others --exclude-standard` (cheapest correct gitignore). Falls back to the `ignore` npm package for non-git worktrees.
  - `readFile(taskId, relPath) → { content: string; encoding: 'utf8' | 'binary'; bytes: number; truncated?: boolean }` — caps at 1 MB; binary detection via extension allowlist + 512-byte magic-byte sniff.
  - `watch(taskId)` / `unwatch(taskId)` — manages chokidar instances keyed by `taskId`. Watches the worktree root with the same gitignore set + static deny-list (`.git`, `node_modules`).
  - Emits `treeChanged(taskId, diff)` debounced 200 ms; `fileChanged(taskId, relPath)` debounced 50 ms.
  - Concurrency: per-`(taskId, path)` in-memory lock so concurrent `readFile` calls share one underlying read.

- `src/main/ipc/fileBrowser.ts` — wraps the service in `IpcResponse<T>` handlers. Two push channels for events.

- `src/main/db/schema.ts` — new table:

  ```
  open_files: id (pk), task_id (fk → tasks, cascade delete), file_path, position (int), opened_at
  unique(task_id, file_path)
  ```

  Plus a Drizzle migration in `drizzle/`.

- `src/types/electron-api.d.ts` — extend `electronAPI` with `fileBrowser.{listTree,readFile,watch,unwatch,onTreeChanged,onFileChanged}` and `openFiles.{list,add,remove,reorder}`.

### Renderer

- `src/renderer/components/FileTree.tsx` (~200 lines) — recursive tree, lazy children fetch on expand, dotfiles toggle in header, subscribes to `onTreeChanged` for the active task.
- `src/renderer/components/FilePane.tsx` (~80 lines) — wraps `FileView` with header (path, close). Subscribes to `onFileChanged` for its own path. Body is `<FileView ... />` today; this is the editor seam.
- `src/renderer/panes/derived.ts` — extend `Pane` type, derive open-file panes from the `open_files` rows for the active task.
- `src/renderer/components/PaneShell.tsx`, `TerminalPaneGroup.tsx` — add `file` branch to the pane-kind switch.
- `LeftSidebar.tsx` — add a collapsible `<FileTree>` section beneath tasks. Visibility persisted in localStorage like other sidebar state.

### Dependencies

- `chokidar`, `better-sqlite3`, `drizzle-orm`, `shiki` — already present.
- `ignore` (~5 KB) — new, only as fallback for non-git worktrees.

## Data flow

**Task switch:**

1. Renderer detects active task change.
2. `fileBrowser:unwatch(prevTaskId)` → service closes chokidar, drops it.
3. `fileBrowser:watch(nextTaskId)` → service opens chokidar on `{worktreePath}/`, gitignore-respecting.
4. Renderer queries `openFiles:list(nextTaskId)` → SQLite returns ordered open panes; hydrate `Pane[]`.
5. `FileTree` requests root via `fileBrowser:listTree(nextTaskId, { showHidden: false })`.

**Opening a file:**

1. User clicks a leaf in `FileTree`.
2. `openFiles:add(taskId, filePath)` → INSERT, returns the new pane.
3. `Pane[]` updates; `TerminalPaneGroup` renders `FilePane`.
4. `FilePane` calls `fileBrowser:readFile(taskId, path)` → renders content via `FileView`.
5. `FilePane` subscribes to `onFileChanged(taskId, path)`.

**File edited externally (Claude or user terminal):**

1. chokidar `change` event → service debounces (50 ms) → emits `fileChanged(taskId, path)`.
2. Subscribed `FilePane`s re-fetch via `readFile` and re-render. Scroll position preserved in local state.

**Tree updates:**

1. chokidar `add`/`unlink`/`addDir`/`unlinkDir` → service builds a minimal diff per task → debounced 200 ms → emits `treeChanged(taskId, diff)`.
2. `FileTree` applies the diff to its local node map; full `listTree` refetch only on inconsistency.

**Closing / reordering:**

- Close: `openFiles:remove(taskId, path)` → DELETE → focus moves to previous pane.
- Reorder (drag): `openFiles:reorder(taskId, paths[])` → UPDATE positions in one transaction.

## Error handling

- **Read fails** (perm, IO): service returns `{ error: 'read_failed', message }`; `FilePane` shows inline error + Retry; pane stays open.
- **File deleted while open**: chokidar `unlink` → pane marked `stale`; header gets strikethrough + "deleted on disk" tag. Re-creation auto-clears.
- **Binary file**: placeholder "Binary file — N KB" instead of garbled tokens.
- **Large file (>1 MB)**: metadata-only return with `truncated: true`; pane shows "File too large to preview" + "Open in IDE" button (existing `openInIde` helper).
- **Watcher errors** (e.g., EMFILE): one reinit attempt, then fallback to no-watcher mode for that task. UI shows "live updates paused" indicator; manual refresh works. Toggling task recovers.
- **Task deleted**: cascade DELETE on `open_files` via existing task-deletion path (FK constraint).
- **Worktree deleted externally** (e.g., `rm -rf` while task still exists): every open `FilePane` for that task lands in the "deleted on disk" state and the tree shows an empty root with an inline "worktree missing" message; no crash. Recovery is to re-create the worktree or delete the task.
- **IPC errors**: standard `IpcResponse<T>` shape; renderer wrappers throw on `success: false`.

## Limits

| Limit                               | Value           | Reason                                           |
| ----------------------------------- | --------------- | ------------------------------------------------ |
| Max file size for preview           | 1 MB            | Shiki tokenization stutters above this           |
| Watch debounce — file changes       | 50 ms           | Coalesce burst writes (e.g., `prettier --write`) |
| Watch debounce — tree diffs         | 200 ms          | Tree reflow more expensive; coalesce harder      |
| Concurrent watched tasks            | 1 (active task) | Filesystem load proportional to attention        |
| Soft cap — open file panes per task | 20              | Warn, don't block; prevents tab explosion        |

## Testing

**Unit (Vitest):**

- `fileBrowser.service.test.ts` (tmpdir): gitignore honored; `git ls-files` path vs `ignore` fallback; binary detection on PNG; truncated marker on large file; `read_failed` on chmod 000; concurrent `readFile` shares one underlying read.
- `fileTree.diff.test.ts`: add → single `add` op; rename → `unlink + add`; 50-event burst coalesces to one diff.
- `panes/derived.test.ts`: `file` panes hydrate in `position` order; closing focused pane shifts focus correctly.

**Integration:**

- `fileBrowser.ipc.test.ts`: real DB + service + tmpdir worktree; write file → `fileChanged` within 250 ms; `mkdir` → `treeChanged`.

**Manual smoke (PR checklist):**

1. Open task → tree appears, gitignored paths absent.
2. Click file → pane opens, Shiki renders.
3. `echo foo >> file.txt` from terminal → pane updates within ~200 ms.
4. `touch new.ts && rm new.ts` → tree adds then removes entry.
5. Switch task → previous panes hide, new task's panes hydrate.
6. Switch back → original panes return.
7. Restart app → open panes survive for active task.
8. `rm -rf` worktree externally → panes show "deleted on disk", no crash.
9. Toggle dotfiles → `.env`, `.github` appear/disappear.
10. Open 5 MB log → "too large" placeholder + "Open in IDE" works.

## Open questions

None — all locked above.
