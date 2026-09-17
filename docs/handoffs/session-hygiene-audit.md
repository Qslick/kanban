# Session hygiene audit

Branch: `feat/session-hygiene` from `personal/stable` (`76b1301a`).
Scope: long-running agent session robustness — teardown, process trees, worktree cleanup, timer/listener leaks, unbounded buffers. Not a visual redesign and not a new product feature.

Did not reimplement: stranded-worktree recovery UI, concurrency cap, verify-before-done, panel review, web-ui motion.

## Intended shutdown contract (founder policy — not changed)

Default `kanban` exit (`SIGINT`/`SIGTERM`/`SIGHUP`):

1. Stop every live PTY session (`markInterruptedAndStopAll`).
2. Move **all** In Progress and Review cards (not just running sessions) to the Done column (`trash`) and mark their session summaries `interrupted`.
3. Delete those cards' task worktrees under `~/.cline/worktrees/<taskId>/` after capturing a best-effort patch.
4. Remove leftover `kanban-task-worktree-setup.lock` files.

`--skip-shutdown-cleanup` (and `dev:full`) is documented as: do **not** move sessions to Done or delete task worktrees. It is **not** permission to leave agent processes running.

That default “trash in-progress work on kanban exit” behavior is product policy. This branch does not change board semantics. See founder question at the end.

## Findings

### 1. Unix process trees leaked after timeout / stop (fixed)

`src/server/process-termination.ts` (`terminateProcessForTimeout`, used by CLI shortcuts with a 60s timeout) sent `SIGTERM` to the child only. No process-group signal, no descendant walk, no `SIGKILL`. A hung `sh -c` grandchild (or an agent that ignores `SIGTERM`) survived.

Windows already used `tree-kill` / `taskkill`. Unix does not spawn those shortcut children `detached: true`, so `process.kill(-pid)` is often `ESRCH` (child is not a group leader). Killing `-pid` when it *is* a group leader is correct; walking the PPID tree covers the rest.

`src/terminal/pty-session.ts` already `SIGTERM`s the PTY process group (`forkpty` makes the child a session leader) but never escalated to `SIGKILL`. Long-stuck Grok/Claude/Codex children could ignore `SIGTERM` and outlive Kanban.

### 2. Shutdown skip path left PTYs running (fixed)

`shutdownRuntimeServer` returned immediately on `skipSessionCleanup` without `markInterruptedAndStopAll`. `--skip-shutdown-cleanup` then closed the HTTP server and exited. PTY children live in their own session, so they do not receive the terminal’s `SIGINT` and became orphans.

Also skipped setup-lock removal, which can block the next `ensure()` with a stale lock.

### 3. Interrupt-all did not suppress auto-restart or run adapter cleanup (fixed)

`stopTaskSession` already set `suppressAutoRestartOnExit`, nulled `onSessionCleanup`, cleared trust timers, and killed the PTY.

`markInterruptedAndStopAll` (shutdown, project remove, workspace dispose) only called `session.stop({ interrupted: true })`. If a browser viewer was still attached, the 3-restarts-in-5s window could spawn new agents during teardown. Adapter `onSessionCleanup` waited for `onExit`; a stuck child never ran it.

`TerminalSessionManager` had no `dispose()`. `workspace-registry.disposeWorkspace` dropped the manager from the map after interrupt, leaving mirrors/listeners until GC, and a pending auto-restart could start a session after the map delete.

### 4. Worktree delete lied about success and skipped prune-after-rm (fixed)

`removeTaskWorktreeInternal`:

- On `git worktree remove` failure, pruned **while the directory still existed**, then `rm -rf`. Git keeps a live registration until the path is gone, so prune was a no-op. Next `ensure()` then hits `missing but already registered`.
- Always returned `ok: true` from `deleteTaskWorktree` if `rm` did not throw, even when git still listed the path.
- Did not clear a leftover `index.lock` in the **linked worktree** git dir (`.git` file → `commondir` present). A killed git can leave that lock and make `worktree remove` fail.
- Did not take the per-repo setup lock, so concurrent Done/Discard/shutdown deletes of the same task could race with `ensure()`.
- Failed `git worktree add` returned an error without cleaning a partial directory/registration.

CLI `task done` / `task delete`, tRPC `workspace.deleteWorktree`, shutdown, and project remove already share `deleteTaskWorktree`. No second delete API was added.

### 5. Timers / intervals (no leak found)

| Site | Cadence | Shutdown |
|---|---|---|
| Auto-review reconciler | 5s `setInterval`, unref’d; per-workspace submit timeouts | `close()` clears interval + submit timers. CLI `shutdown()` closes it **before** session cleanup. |
| Workspace metadata monitor | 1s poll per subscribed workspace | `close()` / `disposeWorkspace` / `disconnectWorkspace` clear the interval. Runtime hub `close()` calls it. |
| Terminal WS heartbeat | 30s ping; ack-stall and pause budgets already from #611 | `close()` stops both heartbeats and terminates clients. |
| Graceful shutdown | shutdown timeout | Cleared in `finalizeExit`. |
| Workspace trust confirm | 100ms | `stopWorkspaceTrustTimers` on stop, exit, interrupt. |

No extra timer fix. Auto-review was not otherwise touched.

### 6. Unbounded memory on long sessions (mostly already capped)

| Buffer | Cap | Notes |
|---|---|---|
| `TerminalStateMirror` | 1,000 lines (`TERMINAL_SCROLLBACK`) | #611 is applied to the only server-side xterm buffer. Restore serializes this buffer, not a second uncapped copy. |
| WS viewer pending output | 512 KiB + pause/ack budgets + forced-restore limit | #611. |
| Workspace trust rolling buffer | 16,384 chars | |
| CLI shortcut stdout/stderr | 64 KiB | |
| Hook `activityText` | Replaced per event, not appended | A single huge tool summary can still be large. |
| Cline in-memory message log | **Uncapped** | `InMemoryClineMessageRepository` grows with the SDK session. Left as-is (chat history is product-visible). |
| Auto-review git probe | Counts/fingerprints, not full diffs | Candidate-only; 0 git work when no review cards. |

No second terminal buffer was found. Radar/activity is the hook activity fields above.

### 7. Restart storms (partially already guarded)

3 restarts / 5s window, and only when a viewer is attached. Explicit stop already suppressed restart. Interrupt-all did not (fixed). Crash loops after the window just stay dead; worktree setup lock is not held across a PTY restart.

### 8. Done vs Trash worktree leftovers

The Done column is `id: "trash"`. UI `cleanupTaskWorkspace` and CLI `task done` / column clear both call `deleteTaskWorktree`. Failures were silent when `ok: true` despite a leftover git registration (fixed by honest `ok`/`error`). HOME/path mismatch (`homedir()` vs a changed `HOME`) can still hide worktrees; tests isolate HOME. Not a code-path split.

### 9. Cline SDK dispose (no change)

`runtime-server.close()` disposes per-workspace Cline task session services and the watcher registry. `prepareForStateReset` awaits dispose. Project remove fires dispose without awaiting (pre-existing, low risk). Turn checkpoints write a temp `GIT_INDEX_FILE` and `rm` it in `finally`.

## Fixes shipped

- Unix (and Windows escalation): `SIGTERM` the child + process group + `tree-kill` descendants, then `SIGKILL` after 2s. Tests inject the scheduler.
- PTY `stop()`: `SIGTERM` the process group, then `SIGKILL` after 2s. Idempotent. Tests use fake timers.
- `TerminalSessionManager.teardownActiveProcess`: always suppress auto-restart, run `onSessionCleanup`, clear trust timers, kill the PTY. Used by stop, interrupt-all, and replacing a leftover process on start.
- `TerminalSessionManager.dispose()`: interrupt-all, drop listeners, dispose mirrors, refuse new starts. Workspace registry always disposes the manager (dropping it used to leak children).
- Shutdown: always stop live sessions and clear setup locks. `skipSessionCleanup` still skips board/worktree mutation.
- `removeTaskWorktreeInternal`: drop linked-worktree `index.lock`, `git worktree remove --force`, `rm -rf`, **then** `git worktree prune`, then porcelain-list. `deleteTaskWorktree` returns `ok: false` if the dir remains or git still lists the path.
- `deleteTaskWorktree` runs under the same per-repo setup lock as `ensure()`.
- Failed `git worktree add` calls `removeTaskWorktreeInternal` before returning or retrying a patch restore.

## Left unfixed (with why)

- **Default shutdown still trashes In Progress + Review and deletes those worktrees.** Board semantics. Founder decision; `--skip-shutdown-cleanup` is the opt-out.
- **Cline in-memory message log is uncapped.** Capping would hide chat history. Needs a product rule (ring buffer vs persist-only).
- **CLI shortcut spawn is not `detached: true`.** Group-kill can `ESRCH`; `tree-kill` covers descendants. Detaching would change shortcut lifetime relative to Kanban; not required once tree-kill + SIGKILL exist.
- **Project remove still `void`s Cline `dispose()`.** Pre-existing; process exit follows. Not a local one-liner without making project remove async.
- **`homedir()` vs `HOME` mismatch** for worktree roots. Environmental; tests already use `withTemporaryHome`.
- **Turn checkpoint refs** (`refs/kanban/checkpoints/...`) are not deleted when a worktree is removed. Harmless leftover refs in the main repo; stranded-worktree work may want this later.
- **Auto-review 5s cadence / metadata 1s poll** cost under many worktrees. Already candidate-gated / subscriber-gated. Load tuning is a feature, not a leak.
- **Stranded worktree Keep/Resume/Discard UI** lives on `feat/stranded-worktree`. This branch only hardens `deleteTaskWorktree`.

## Founder-policy question

Should a normal `kanban` exit leave In Progress / Review cards on the board with their worktrees intact (only kill processes), matching `--skip-shutdown-cleanup`? Today it moves them to Done and deletes worktrees. Daily-driver users with many concurrent Grok/Claude/Codex sessions may want the skip behavior as the default, and keep the current sweep as an explicit “reset the board” flag. Not changed here.
