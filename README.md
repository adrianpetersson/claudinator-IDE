# Claudinator IDE

A personal fork of [Dash](https://github.com/syv-ai/dash) — turned into something closer to a small IDE for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

You open a project, create tasks, and each task gets its own git worktree, branch, and terminal session. Claude Code runs inside the worktree, so multiple tasks can run in parallel without stepping on each other. Dash already does that. Where this fork goes further is making the surrounding workspace — panes, file tree, diffs, theming — feel like an editor instead of a launcher.

![Claudinator screenshot](docs/screenshot.png)

## What this fork adds on top of Dash

These are the things I built or rewrote after forking. Everything else (worktree pool, project/task model, GitHub/ADO integrations, snapshots, remote control) comes from Dash and is credited at the bottom.

- **Side-by-side terminal panes.** Each task can hold multiple terminals laid out horizontally — a primary Claude session plus _scratch panes_ for ad-hoc commands, secondary agents, or one-off `/rename`-able sessions. Scratch panes get their own header (sparkles icon, green accent) so they're visually distinct from the task's main session.
- **Built-in file browser.** A `Files` section in the left sidebar with a lazy-expanding file tree per task (gitignore-aware, dotfiles toggle). Clicking a file opens a view-only `FilePane` next to the terminal — meant as an "editor seam," not a replacement for your real editor. Open files are persisted per task and survive restarts. Watched live with chokidar so external edits show up immediately.
- **File viewer with syntax highlighting.** A `Diff / File` toggle in the modal header swaps between a unified diff and a syntax-highlighted view of the current file, rendered with [Shiki](https://shiki.style/) using a Tokyo Night palette.
- **Diff viewer as a side panel, not a fullscreen modal.** Opening a diff hides the left sidebar and changes panel, leaving you with a focused two-column terminal+diff layout. Back-arrow returns to the full UI.
- **Clickable file paths in Claude's TUI.** Paths that scroll past in Claude's output are turned into links — clicking opens the file's diff in focus mode (with staged-vs-unstaged auto-detection). Paren-wrapped paths and edit prefixes are handled.
- **Tokyo Night everywhere.** Terminal colors and dark-mode CSS tokens are tuned to match [Ghostty](https://ghostty.org/)'s Tokyo Night defaults so the embedded xterm doesn't look like an alien guest.
- **Ghostty-style compact statusline.** Replaced the upstream usage progress bars with a one-line text statusline. If you already have a Claude Code `statusLine` configured, it's wrapped instead of replaced — you don't lose your own statusline.
- **Self-healing hook settings.** Claudinator writes per-port hook config so it can intercept Claude lifecycle events; if a previous run left a stale port behind, the app now repairs it on startup instead of spamming `ECONNREFUSED`.
- **Big-worktree friendly.** File-watcher and diff paths were rewritten to avoid blocking the main process on large repos.
- **Parallel dev runs.** Single-instance lock is skipped in dev so you can run two Claudinator builds at once while iterating.

### Things removed from upstream

I trimmed a few things to keep this fork focused on local dev:

- PostHog telemetry — gone.
- Pixel Agents, in-app auto-update, and the CI signing pipeline — gone.
- The DAG commit graph — removed (I never used it).

## Inherited from Dash

The bones are still Dash, and the bones are good:

- Project / task model with worktrees per task and a reserve pool for instant task creation.
- xterm.js + node-pty terminals with snapshot/restore on task switch.
- File-changes panel with stage/unstage/discard.
- GitHub issues + Azure DevOps work-item linking with PR detection.
- Remote control (QR code / URL to drive a task from another device).
- Activity indicators (busy/idle) with desktop notifications and sound alerts.
- Editor integration (Cursor, VS Code, Zed, Vim) and customizable keybindings.
- Per-project setup scripts that run after worktree creation.

## Install

This fork doesn't ship prebuilt releases — build from source (below), or grab an upstream binary from [Dash Releases](https://github.com/syv-ai/dash/releases/latest) if you want the unmodified version.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- Git

## Development

```bash
pnpm install
npx electron-rebuild -f -w node-pty,better-sqlite3   # rebuild native modules for Electron
pnpm dev                                             # Vite on :3000 + Electron
```

Renderer hot-reloads. Main-process changes need a restart (`pnpm dev:main` or kill and re-run `pnpm dev`).

To rebuild and launch the main process by itself:

```bash
pnpm build:main
npx electron dist/main/main/entry.js --dev
```

## Build

```bash
pnpm build              # compile main + renderer
pnpm package:mac        # macOS .dmg (arm64)
pnpm package:linux      # Linux .AppImage (x64)
```

Output lands in `release/`.

## Project structure

```
src/
├── main/                       # Electron main process
│   ├── entry.ts                # path aliases, app name, loads main.ts
│   ├── main.ts                 # boot: PATH fix, DB init, IPC, window
│   ├── preload.ts              # contextBridge API
│   ├── window.ts               # BrowserWindow
│   ├── db/                     # SQLite + Drizzle (projects, tasks, conversations, open_files)
│   ├── ipc/                    # IPC handlers (app, db, git, pty, worktree, github, ado, fileBrowser, openFiles)
│   └── services/               # GitService, FileBrowserService, WorktreePoolService,
│                               # ptyManager, TerminalSnapshotService, HookServer, ...
├── renderer/                   # React UI
│   ├── App.tsx                 # root state, keybindings, layout
│   ├── components/
│   │   ├── LeftSidebar.tsx        # projects + nested tasks + Files section
│   │   ├── MainContent.tsx        # pane group host + project overview
│   │   ├── TerminalPaneGroup.tsx  # horizontal pane layout (task + scratch panes)
│   │   ├── PaneShell.tsx          # single-pane chrome
│   │   ├── TerminalPane.tsx       # xterm pane
│   │   ├── FilePane.tsx           # view-only file pane (editor seam)
│   │   ├── FileTree.tsx           # lazy-expand tree, gitignore-aware
│   │   ├── FileView.tsx           # shiki-highlighted file view
│   │   ├── DiffViewer.tsx         # unified diff with Diff/File toggle
│   │   └── FileChangesPanel.tsx
│   └── terminal/                  # xterm.js lifecycle, session pool, clickable file paths
├── shared/types.ts             # Project, Task, Pane, GitStatus, ...
└── types/electron-api.d.ts     # window.electronAPI declarations
```

## Default keybindings

| Shortcut      | Action         |
| ------------- | -------------- |
| `Cmd+N`       | New task       |
| `Cmd+Shift+K` | Next task      |
| `Cmd+Shift+J` | Previous task  |
| `Cmd+Shift+A` | Stage all      |
| `Cmd+Shift+U` | Unstage all    |
| `Cmd+,`       | Settings       |
| `Cmd+O`       | Open folder    |
| ``Cmd+` ``    | Focus terminal |
| `Esc`         | Close overlay  |

All of these are remappable in Settings → Keybindings.

## Tech stack

|           |                                       |
| --------- | ------------------------------------- |
| Shell     | Electron 30                           |
| UI        | React 18, TypeScript, Tailwind CSS 3  |
| Build     | Vite 5, pnpm                          |
| Terminal  | xterm.js + node-pty                   |
| Highlight | Shiki (Tokyo Night)                   |
| Watching  | chokidar v4                           |
| Database  | SQLite (better-sqlite3) + Drizzle ORM |
| Package   | electron-builder                      |

## Data storage

- **Database** — `~/Library/Application Support/Claudinator/app.db` (macOS) / `~/.config/Claudinator/app.db` (Linux)
- **Terminal snapshots** — `~/Library/Application Support/Claudinator/terminal-snapshots/`
- **Worktrees** — `{project}/../worktrees/{task-slug}/`

## Acknowledgements

Forked from [Dash](https://github.com/syv-ai/dash) by the syv-ai team — the project model, worktree pool, and most of the integrations are theirs. Dash itself is inspired by [emdash](https://github.com/generalaction/emdash). All credit upstream; bugs in this fork are mine.

## License

MIT
