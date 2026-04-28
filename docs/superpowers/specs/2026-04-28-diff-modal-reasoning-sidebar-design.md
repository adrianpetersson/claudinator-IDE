# Diff Modal Reasoning Sidebar — Design

**Date:** 2026-04-28
**Status:** Draft (awaiting user review)

## Goal

Inside the existing fullscreen diff modal (`DiffViewer.tsx`), surface _why_ each change was made by displaying a sidebar of agent turns that touched the current file. The user reviews the diff retrospectively and currently has no way to connect a hunk back to the agent's reasoning. This is the primary pain point ("pain B" from brainstorming).

The diff itself is not modified. No inline comments, no badges in the gutter — the code stays clean.

## Non-Goals

- Live, real-time tracking during agent execution.
- Cross-file narrative views (a global "task review" surface). The sidebar shows only turns that touched the _current_ file.
- In-place editing of the diff or sending follow-up messages from the modal. Those are existing flows handled elsewhere.
- Replacing the existing minimap. It can stay as a thin strip alongside the new sidebar, or be retired — decided during implementation review (see Open Questions).

## User Experience

When the user opens the diff modal for a changed file:

1. The modal opens at its current size (or slightly wider — see Open Questions).
2. A right-side sidebar appears, showing one card per agent turn that touched this file.
3. Each card contains:
   - Turn number and tool kind (e.g., "Turn 4 · Edit · 2 hunks").
   - The agent's reasoning text from that turn (the assistant message that contained the tool call), trimmed to ~3 lines with a "show more" affordance.
4. **Click a card** → the diff scrolls to and highlights the hunk(s) that turn produced.
5. **Click a hunk** → the matching card highlights and scrolls into view in the sidebar.
6. If the modal is opened for a file Claudinator has no transcript for (e.g., changes made manually outside an agent session), the sidebar shows an empty state explaining "No agent reasoning available for this file."

## Architecture

The implementation is **read-only against Claude Code's session transcript**. We do not need new hook payloads or any new persistence — the canonical record of agent messages and tool calls is already in `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, the file Claude Code writes during every session.

This is a correction from the brainstorming conversation, where I described capturing tool calls via the existing `/hook/tool-start` and `/hook/tool-end` endpoints. Those endpoints currently only update `activityMonitor` for live UI state — they don't persist payloads, and they don't need to. The transcript JSONL is a strictly better source: it has the agent's reasoning text alongside each tool call, every tool call has a stable `id`, and replays survive app restarts without any new schema.

### New service: `TranscriptService`

Location: `src/main/services/TranscriptService.ts`.

Responsibilities:

- Given a `taskId`, locate the session JSONL file using the existing logic in `ptyManager.ts` (which already finds `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`).
- Parse the JSONL stream. Each line is a message; assistant messages contain `content[]` with interleaved `text` blocks (the reasoning) and `tool_use` blocks (the actions).
- Build an indexed structure: `Map<filePath, ReasoningTurn[]>` where each `ReasoningTurn` is `{ turnIndex, toolUseId, toolName, toolInput, reasoningText }`.
- Cache parsed transcripts in memory keyed by `(taskId, fileMtime)` to avoid re-parsing on every modal open. Invalidate when the JSONL's mtime changes.

Public API:

```ts
class TranscriptService {
  static async getReasoningForFile(taskId: string, filePath: string): Promise<ReasoningTurn[]>;
}
```

### IPC

One new handler in a new `src/main/ipc/transcriptIpc.ts`:

- `transcript:getReasoningForFile` → `(taskId, filePath) → IpcResponse<ReasoningTurn[]>`.

Wire through `electronAPI.transcript.getReasoningForFile` in the preload bridge and `electron-api.d.ts`.

### Hunk → turn mapping

The transcript gives us tool inputs (`old_string`/`new_string` for `Edit`, full `content` for `Write`), not pre-computed hunks. To link the _final_ unified-diff hunks (which `DiffViewer` already renders from `git diff` against `baseRef`) back to turns, the simplest correct approach:

- For each `ReasoningTurn` whose tool touched this file, compute the line range it modified by replaying tool inputs against the file's text-at-that-moment. We don't need exact hunks; line ranges are enough for highlight + scroll.
- For each rendered diff hunk, find the most recent `ReasoningTurn` whose line range overlaps it. That turn becomes the hunk's "primary" turn.
- If multiple turns overlap, the card-click behavior shows all hunks the turn touched; the hunk-click behavior picks the most recent.

This is approximate when turns rewrite the same lines twice. The MVP shows the most recent edit; we can extend to "edited in turns 4, 7" later if it proves valuable.

### Renderer

New component: `src/renderer/components/DiffViewer/ReasoningSidebar.tsx` (extracted into the directory alongside a moved `DiffViewer.tsx`).

`DiffViewer.tsx` is currently 673 lines. While integrating the sidebar, split it into:

- `DiffViewer.tsx` — the modal shell, layout, scroll coordination.
- `DiffPane.tsx` — the existing diff rendering (hunks, lines, popovers, comments).
- `MinimapRail.tsx` — the existing scrollbar minimap.
- `ReasoningSidebar.tsx` — the new sidebar.

This is a targeted split, not a rewrite — it keeps each file focused enough that subsequent edits stay reliable. No changes to the diff rendering logic itself.

State shared between `DiffPane` and `ReasoningSidebar` (active hunk, active turn, scroll sync) lives in `DiffViewer.tsx`. The two children receive callbacks; they don't talk to each other directly.

## Data Flow

```
DiffViewer (renderer)
  ├── on open, with (taskId, filePath):
  │     calls electronAPI.transcript.getReasoningForFile
  │           ↓ IPC
  │     TranscriptService (main)
  │           ├── locates ~/.claude/projects/.../<sessionId>.jsonl via ptyManager helpers
  │           ├── parses (cached by mtime)
  │           └── returns ReasoningTurn[] for filePath
  │
  ├── computes hunk-to-turn mapping client-side from the diff + reasoning turns
  ├── renders DiffPane (left/center) and ReasoningSidebar (right)
  └── owns activeTurnId state; click handlers in either child update it
```

## Error Handling

- Transcript file missing → empty state in sidebar ("No agent reasoning available for this file"). The diff renders normally.
- Transcript file malformed (a corrupt JSONL line) → log and skip the bad line; return whatever was successfully parsed. The user still gets partial reasoning.
- Tool replay can't find expected `old_string` (file changed externally between edits) → mark that turn as "unmapped" and place its card at the bottom of the sidebar with a subtle "couldn't locate in current file" hint. Don't let one unmappable turn break the rest.

These are local boundaries. We do not need retries or fallbacks for IPC — the renderer treats a failed call the same as an empty result.

## Testing

- **`TranscriptService` unit tests** (`src/main/services/__tests__/TranscriptService.test.ts`): given a fixture JSONL, returns the expected `ReasoningTurn[]` for a given file. Cover at minimum: a single `Edit`, a `Write`, multiple turns to the same file, a turn with text-only assistant message followed by a tool turn, and a malformed line.
- **Hunk-to-turn mapping** unit test: given a synthetic diff and a synthetic list of turns with line ranges, asserts the correct mapping.
- **`ReasoningSidebar` component test**: renders cards, click highlights, empty state. Reuse whatever testing setup the renderer already has.

No new e2e tests for this — the manual test loop (run a Claude Code session in Claudinator, open the diff modal) is sufficient validation given the project's current testing posture.

## Open Questions

These should be resolved during implementation review or by user choice:

1. **Modal width.** The current modal has visible backdrop padding. Do we widen it to true fullscreen when the sidebar opens, or keep the current size and accept a narrower diff pane? Default plan: keep current width, sidebar takes ~280px from the right of the existing modal area. Easy to revisit.
2. **Minimap fate.** Retire it entirely, or keep it as a thin (~6px) strip between the diff and the sidebar? Default plan: keep it as a thin strip — it carries useful change-density info that the sidebar doesn't replace.
3. **Card text length.** Trim agent reasoning to 3 lines? 5? Some turns have terse reasoning, some have paragraphs. Default plan: 3 lines + "show more" expander.

## What Changes

**New files:**

- `src/main/services/TranscriptService.ts`
- `src/main/services/__tests__/TranscriptService.test.ts`
- `src/main/ipc/transcriptIpc.ts`
- `src/renderer/components/DiffViewer/ReasoningSidebar.tsx`
- `src/renderer/components/DiffViewer/DiffPane.tsx`
- `src/renderer/components/DiffViewer/MinimapRail.tsx`
- `src/renderer/components/DiffViewer/index.ts`

**Modified files:**

- `src/renderer/components/DiffViewer.tsx` → reduced to modal shell and scroll coordination; existing logic moved into the new files above. (Or removed in favor of `DiffViewer/index.tsx`.)
- `src/main/ipc/index.ts` → register the new IPC handler.
- `src/preload/index.ts` and `src/types/electron-api.d.ts` → expose `electronAPI.transcript.getReasoningForFile`.
- `src/shared/types.ts` → add the `ReasoningTurn` type.

**No DB schema changes.** No new migrations.
