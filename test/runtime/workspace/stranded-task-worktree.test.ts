import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { getTaskWorktreesHomePath } from "../../../src/state/workspace-state";
import {
	buildRecoveredTaskBranchName,
	discardStrandedTaskWorktree,
	inspectStrandedTaskWorktree,
	isStrandedTaskWorktree,
	keepStrandedTaskWorktree,
} from "../../../src/workspace/stranded-task-worktree";
import { getWorkspaceFolderLabelForWorktreePath } from "../../../src/workspace/task-worktree-path";
import { createGitTestEnv } from "../../utilities/git-env";
import { createTempDir } from "../../utilities/temp-dir";

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(
			[`git ${args.join(" ")} failed in ${cwd}`, result.stdout.trim(), result.stderr.trim()]
				.filter((part) => part.length > 0)
				.join("\n"),
		);
	}
	return result.stdout.trim();
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-stranded-home-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

function initRepository(path: string): string {
	mkdirSync(path, { recursive: true });
	runGit(path, ["init"]);
	runGit(path, ["config", "user.name", "Kanban Test"]);
	runGit(path, ["config", "user.email", "kanban-test@example.com"]);
	writeFileSync(join(path, "README.md"), "hello\n", "utf8");
	runGit(path, ["add", "."]);
	runGit(path, ["commit", "-qm", "init"]);
	return runGit(path, ["symbolic-ref", "--short", "HEAD"]);
}

function addTaskWorktree(repoPath: string, taskId: string): string {
	const worktreePath = join(getTaskWorktreesHomePath(), taskId, getWorkspaceFolderLabelForWorktreePath(repoPath));
	mkdirSync(dirname(worktreePath), { recursive: true });
	runGit(repoPath, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
	return worktreePath;
}

describe("isStrandedTaskWorktree", () => {
	it("is stranded when the worktree exists, the card is on the board, and the session is dead", () => {
		expect(
			isStrandedTaskWorktree({
				exists: true,
				cardOnBoard: true,
				sessionState: "failed",
			}),
		).toBe(true);
		expect(
			isStrandedTaskWorktree({
				exists: true,
				cardOnBoard: true,
				sessionState: "interrupted",
			}),
		).toBe(true);
		expect(
			isStrandedTaskWorktree({
				exists: true,
				cardOnBoard: true,
				sessionState: null,
			}),
		).toBe(true);
	});

	it("is not stranded while the session is running or awaiting review", () => {
		expect(
			isStrandedTaskWorktree({
				exists: true,
				cardOnBoard: true,
				sessionState: "running",
			}),
		).toBe(false);
		expect(
			isStrandedTaskWorktree({
				exists: true,
				cardOnBoard: true,
				sessionState: "awaiting_review",
			}),
		).toBe(false);
	});
});

describe.sequential("stranded task worktree keep and discard", () => {
	it("refuses discard when HEAD is unreachable, then keeps recovered/<id> so discard can proceed", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-stranded-worktree-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				const baseRef = initRepository(repoPath);
				const taskId = "abc12";
				const worktreePath = addTaskWorktree(repoPath, taskId);

				writeFileSync(join(worktreePath, "unique.txt"), "only in worktree\n", "utf8");
				runGit(worktreePath, ["add", "."]);
				runGit(worktreePath, ["commit", "-qm", "unique stranded commit"]);
				const uniqueHead = runGit(worktreePath, ["rev-parse", "HEAD"]);

				const beforeKeep = await inspectStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
					sessionState: "failed",
					cardOnBoard: true,
				});
				expect(beforeKeep.exists).toBe(true);
				expect(beforeKeep.stranded).toBe(true);
				expect(beforeKeep.reachable).toBe(false);
				expect(beforeKeep.canDiscard).toBe(false);
				expect(beforeKeep.headCommit).toBe(uniqueHead);

				const refused = await discardStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
					sessionState: "failed",
				});
				expect(refused.ok).toBe(false);
				expect(refused.refused).toBe(true);
				expect(refused.removed).toBe(false);
				expect(refused.error).toContain(`recovered/${taskId}`);
				expect(existsSync(worktreePath)).toBe(true);

				const kept = await keepStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
				});
				expect(kept.ok).toBe(true);
				expect(kept.created).toBe(true);
				expect(kept.branch).toBe(buildRecoveredTaskBranchName(taskId));
				expect(runGit(repoPath, ["rev-parse", kept.branch])).toBe(uniqueHead);

				const keptAgain = await keepStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
				});
				expect(keptAgain.ok).toBe(true);
				expect(keptAgain.created).toBe(false);

				const afterKeep = await inspectStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
					sessionState: "failed",
					cardOnBoard: true,
				});
				expect(afterKeep.reachable).toBe(true);
				expect(afterKeep.canDiscard).toBe(true);
				expect(afterKeep.recoveredBranchExists).toBe(true);

				const discarded = await discardStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
					sessionState: "failed",
				});
				expect(discarded.ok).toBe(true);
				expect(discarded.refused).toBe(false);
				expect(discarded.removed).toBe(true);
				expect(existsSync(worktreePath)).toBe(false);
				expect(runGit(repoPath, ["rev-parse", kept.branch])).toBe(uniqueHead);
			} finally {
				cleanup();
			}
		});
	}, 30_000);

	it("allows discard without keep when HEAD is already on a branch", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-stranded-reachable-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				const baseRef = initRepository(repoPath);
				const taskId = "def34";
				const worktreePath = addTaskWorktree(repoPath, taskId);

				const status = await inspectStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
					sessionState: "interrupted",
					cardOnBoard: true,
				});
				expect(status.stranded).toBe(true);
				expect(status.reachable).toBe(true);
				expect(status.canDiscard).toBe(true);

				const discarded = await discardStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
					sessionState: "interrupted",
				});
				expect(discarded.error).toBeUndefined();
				expect(discarded.ok).toBe(true);
				expect(discarded.refused).toBe(false);
				expect(discarded.removed).toBe(true);
				expect(existsSync(worktreePath)).toBe(false);
			} finally {
				cleanup();
			}
		});
	}, 30_000);

	it("does not list a live session as stranded and refuses discard while running", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-stranded-live-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				const baseRef = initRepository(repoPath);
				const taskId = "ghi56";
				const worktreePath = addTaskWorktree(repoPath, taskId);

				const status = await inspectStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
					sessionState: "running",
					cardOnBoard: true,
				});
				expect(status.exists).toBe(true);
				expect(status.stranded).toBe(false);
				expect(status.canDiscard).toBe(false);

				const refused = await discardStrandedTaskWorktree({
					cwd: repoPath,
					taskId,
					baseRef,
					sessionState: "running",
				});
				expect(refused.ok).toBe(false);
				expect(refused.refused).toBe(true);
				expect(existsSync(worktreePath)).toBe(true);
			} finally {
				cleanup();
			}
		});
	}, 30_000);
});
