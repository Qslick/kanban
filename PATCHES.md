# Personal stable patches

This is a personal daily-driver fork of [cline/kanban](https://github.com/cline/kanban).
It is not an upstream release and is not published to npm.

Base: `upstream/main` at `abd4912` (2026-09-04 security pin), not npm `v0.1.70`.

Install this checkout with `npm run link`. Roll back to the published binary with `npm run unlink` then `npm i -g kanban@0.1.70` if PATH no longer has it.

## Accepted

| Source | Why |
|---|---|
| #641 | Drain stdout before `process.exit()` so piped `task list` JSON is not truncated at 64 KiB |
| #642 | Include `title` in CLI task JSON |
| #611 (includes #596, #607) | Cap terminal scrollback; heartbeat and bound slow/dead viewer sockets so they cannot stall the agent PTY |
| #615 (includes #613) | Run auto-review in the runtime so review cards do not strand when no browser tab is open |
| #620 | Worktree ignored-path allowlist; `.env` and other credentials are not symlinked |
| #640 | Strip incomplete tool turns before Cline session restart |
| #558 unique part | Recover Cline restart config from the persisted session after a process restart. Duplicate `stripIncompleteToolTurns` skipped (already in #640) |
| #559 ported | Failed sessions stay in Review (runtime auto-review gate + red card indicator). The original PR targeted a deleted UI hook |
| Issue #473 | AND dependency auto-start: a Backlog card starts only when every linked Review prerequisite is Done |
| #592 | Agent-agnostic per-task model and effort wiring. Prerequisite for Grok |
| #603 unique commits | Grok Build CLI as a launch-supported runtime agent |

## Skipped

| Source | Why |
|---|---|
| Dump of all 103 open PRs | Conflicts, drafts, duplicates, unreviewed permission-bypass surface |
| Drafts | Not merge-ready |
| #583 | Duplicate of #596 (landed via #611) |
| #54 | Draft session-resume from Mar 2026 |
| #324 | Large review-resume rewrite overlapping the #611 terminal stack; re-evaluate if review resume is still broken |
| Desktop auto-update (#440, #464–#468) | This fork runs the CLI |
| Extra agent runtimes (Pi, AG2, Kimi, Cursor, Copilot, Hermes, Prime, qwen, Kiro) | Not used here |
| #643 Cline CLI | Cherry-pick conflicted: the unique commit also deletes AGENTS.md / DEVELOPMENT.md and depends on unrelated cline-sdk cache PRs. Revisit as a surgical patch |

## Planned

None. Revisit Cline CLI (#643) only if you start using `cline` as a board agent.
