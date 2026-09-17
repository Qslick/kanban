import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempDir } from "../utilities/temp-dir";

const childProcessMocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	execFilePromise: vi.fn(),
}));

const lockedFileSystemMocks = vi.hoisted(() => ({
	withLock: vi.fn(),
	writeTextFileAtomic: vi.fn(),
}));

const workspaceStateMocks = vi.hoisted(() => ({
	getRuntimeHomePath: vi.fn(),
	getTaskWorktreesHomePath: vi.fn(),
	loadWorkspaceContext: vi.fn(),
}));

const taskWorktreePathMocks = vi.hoisted(() => ({
	getWorkspaceFolderLabelForWorktreePath: vi.fn(),
	normalizeTaskIdForWorktreePath: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: Object.assign(childProcessMocks.execFile, {
		[promisify.custom]: childProcessMocks.execFilePromise,
	}),
}));

vi.mock("../../src/fs/locked-file-system.js", () => ({
	lockedFileSystem: {
		withLock: lockedFileSystemMocks.withLock,
		writeTextFileAtomic: lockedFileSystemMocks.writeTextFileAtomic,
	},
}));

vi.mock("../../src/state/workspace-state.js", () => ({
	getRuntimeHomePath: workspaceStateMocks.getRuntimeHomePath,
	getTaskWorktreesHomePath: workspaceStateMocks.getTaskWorktreesHomePath,
	loadWorkspaceContext: workspaceStateMocks.loadWorkspaceContext,
}));

vi.mock("../../src/workspace/task-worktree-path.js", () => ({
	getWorkspaceFolderLabelForWorktreePath: taskWorktreePathMocks.getWorkspaceFolderLabelForWorktreePath,
	KANBAN_TASK_WORKTREES_DIR_NAME: "worktrees",
	normalizeTaskIdForWorktreePath: taskWorktreePathMocks.normalizeTaskIdForWorktreePath,
}));

import {
	deleteTaskWorktree,
	ensureTaskWorktreeIfDoesntExist,
	removeTaskWorktreeSetupLock,
} from "../../src/workspace/task-worktree";

type ExecFileOptions = {
	cwd?: string;
	encoding?: string;
	maxBuffer?: number;
	env?: NodeJS.ProcessEnv;
};

function createGitError(message: string): NodeJS.ErrnoException & { stdout: string; stderr: string; code: number } {
	const error = new Error(message) as NodeJS.ErrnoException & { stdout: string; stderr: string };
	Object.assign(error, {
		code: 1,
		stdout: "",
		stderr: message,
	});
	return error as NodeJS.ErrnoException & { stdout: string; stderr: string; code: number };
}

function stripConfigFlags(args: readonly string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "-c" && i + 1 < args.length) {
			i += 1;
			continue;
		}
		result.push(args[i] as string);
	}
	return result;
}

function getCommandArgs(args: readonly string[], options?: ExecFileOptions): { cwd: string; command: string[] } {
	const cleaned = stripConfigFlags(args);
	if (cleaned[0] === "-C" && typeof cleaned[1] === "string") {
		return {
			cwd: cleaned[1],
			command: cleaned.slice(2),
		};
	}
	if (typeof options?.cwd === "string") {
		return {
			cwd: options.cwd,
			command: cleaned,
		};
	}
	throw new Error(`Unexpected git args: ${args.join(" ")}`);
}

describe.sequential("task-worktree serialization", () => {
	beforeEach(() => {
		childProcessMocks.execFile.mockReset();
		childProcessMocks.execFilePromise.mockReset();
		lockedFileSystemMocks.withLock.mockReset();
		lockedFileSystemMocks.writeTextFileAtomic.mockReset();
		workspaceStateMocks.getRuntimeHomePath.mockReset();
		workspaceStateMocks.getTaskWorktreesHomePath.mockReset();
		workspaceStateMocks.loadWorkspaceContext.mockReset();
		taskWorktreePathMocks.getWorkspaceFolderLabelForWorktreePath.mockReset();
		taskWorktreePathMocks.normalizeTaskIdForWorktreePath.mockReset();

		let lockQueue = Promise.resolve();
		lockedFileSystemMocks.withLock.mockImplementation(
			async (_request: unknown, operation: () => Promise<unknown>) => {
				const waitForTurn = lockQueue;
				let releaseLock: () => void = () => {};
				lockQueue = new Promise<void>((resolve) => {
					releaseLock = resolve;
				});
				await waitForTurn;
				try {
					return await operation();
				} finally {
					releaseLock();
				}
			},
		);
		lockedFileSystemMocks.writeTextFileAtomic.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("serializes submodule initialization across concurrent worktree creation", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-lock-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const runtimeHomePath = join(sandboxRoot, "runtime-home");
			const worktreesHomePath = join(sandboxRoot, "worktrees-home");
			mkdirSync(join(repoPath, ".git"), { recursive: true });
			mkdirSync(runtimeHomePath, { recursive: true });
			mkdirSync(worktreesHomePath, { recursive: true });

			workspaceStateMocks.getRuntimeHomePath.mockReturnValue(runtimeHomePath);
			workspaceStateMocks.getTaskWorktreesHomePath.mockReturnValue(worktreesHomePath);
			workspaceStateMocks.loadWorkspaceContext.mockResolvedValue({
				repoPath,
			});
			taskWorktreePathMocks.getWorkspaceFolderLabelForWorktreePath.mockReturnValue("repo");
			taskWorktreePathMocks.normalizeTaskIdForWorktreePath.mockImplementation((taskId: string) => taskId);

			const worktreeHeads = new Map<string, string>();
			let activeSubmoduleUpdates = 0;
			let maxConcurrentSubmoduleUpdates = 0;

			childProcessMocks.execFilePromise.mockImplementation(
				async (_file: string, args: readonly string[], options?: ExecFileOptions) => {
					const { cwd, command } = getCommandArgs(args, options);

					if (command[0] === "rev-parse" && command[1] === "--git-common-dir") {
						return {
							stdout: ".git\n",
							stderr: "",
						};
					}

					if (command[0] === "rev-parse" && command[1] === "HEAD") {
						const head = worktreeHeads.get(cwd);
						if (!head) {
							throw createGitError("fatal: not a git repository");
						}
						return {
							stdout: `${head}\n`,
							stderr: "",
						};
					}

					if (command[0] === "rev-parse" && command[1] === "--verify") {
						return {
							stdout: "base-commit\n",
							stderr: "",
						};
					}

					if (command[0] === "worktree" && command[1] === "add") {
						const worktreePath = command[3];
						const commit = command[4] ?? "base-commit";
						if (!worktreePath) {
							throw createGitError("fatal: missing worktree path");
						}
						mkdirSync(worktreePath, { recursive: true });
						writeFileSync(
							join(worktreePath, ".gitmodules"),
							'[submodule "evals/cline-bench"]\n\tpath = evals/cline-bench\n\turl = ../cline-bench\n',
							"utf8",
						);
						worktreeHeads.set(worktreePath, commit);
						return {
							stdout: "",
							stderr: "",
						};
					}

					if (command[0] === "config" && command[1] === "--file") {
						return {
							stdout: "submodule.evals/cline-bench.path evals/cline-bench\n",
							stderr: "",
						};
					}

					if (command[0] === "submodule" && command[1] === "update") {
						activeSubmoduleUpdates += 1;
						maxConcurrentSubmoduleUpdates = Math.max(maxConcurrentSubmoduleUpdates, activeSubmoduleUpdates);
						await new Promise((resolve) => {
							setTimeout(resolve, 25);
						});
						mkdirSync(join(cwd, "evals", "cline-bench"), { recursive: true });
						writeFileSync(join(cwd, "evals", "cline-bench", ".git"), "gitdir: fake\n", "utf8");
						activeSubmoduleUpdates -= 1;
						return {
							stdout: "",
							stderr: "",
						};
					}

					if (command[0] === "ls-files") {
						return {
							stdout: "",
							stderr: "",
						};
					}

					if (command[0] === "rev-parse" && command[1] === "--git-path") {
						return {
							stdout: ".git/info/exclude\n",
							stderr: "",
						};
					}

					throw createGitError(`Unhandled git command: ${command.join(" ")}`);
				},
			);

			const [first, second] = await Promise.all([
				ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-a",
					baseRef: "HEAD",
				}),
				ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-b",
					baseRef: "HEAD",
				}),
			]);

			const firstLockRequest = lockedFileSystemMocks.withLock.mock.calls[0]?.[0] as {
				path: string;
				type: string;
				lockfileName: string;
			};
			expect(first, JSON.stringify(first, null, 2)).toMatchObject({ ok: true, baseCommit: "base-commit" });
			expect(second, JSON.stringify(second, null, 2)).toMatchObject({ ok: true, baseCommit: "base-commit" });
			expect(firstLockRequest).toMatchObject({
				path: join(repoPath, ".git"),
				type: "directory",
				lockfileName: "kanban-task-worktree-setup.lock",
			});
			expect(maxConcurrentSubmoduleUpdates).toBe(1);
		} finally {
			cleanup();
		}
	});

	it("removes the task worktree setup lock from the repository git directory", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-lock-cleanup-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const lockPath = join(repoPath, ".git", "kanban-task-worktree-setup.lock");
			mkdirSync(lockPath, { recursive: true });

			await expect(removeTaskWorktreeSetupLock(repoPath)).resolves.toBe(true);
			expect(existsSync(lockPath)).toBe(false);
			await expect(removeTaskWorktreeSetupLock(repoPath)).resolves.toBe(false);
		} finally {
			cleanup();
		}
	});
});

describe.sequential("task-worktree delete hygiene", () => {
	beforeEach(() => {
		childProcessMocks.execFile.mockReset();
		childProcessMocks.execFilePromise.mockReset();
		lockedFileSystemMocks.withLock.mockReset();
		lockedFileSystemMocks.writeTextFileAtomic.mockReset();
		workspaceStateMocks.getRuntimeHomePath.mockReset();
		workspaceStateMocks.getTaskWorktreesHomePath.mockReset();
		workspaceStateMocks.loadWorkspaceContext.mockReset();
		taskWorktreePathMocks.getWorkspaceFolderLabelForWorktreePath.mockReset();
		taskWorktreePathMocks.normalizeTaskIdForWorktreePath.mockReset();

		let lockQueue = Promise.resolve();
		lockedFileSystemMocks.withLock.mockImplementation(
			async (_request: unknown, operation: () => Promise<unknown>) => {
				const waitForTurn = lockQueue;
				let releaseLock: () => void = () => {};
				lockQueue = new Promise<void>((resolve) => {
					releaseLock = resolve;
				});
				await waitForTurn;
				try {
					return await operation();
				} finally {
					releaseLock();
				}
			},
		);
		lockedFileSystemMocks.writeTextFileAtomic.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("prunes git worktree registration after rm when remove fails", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-delete-prune-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const worktreesHomePath = join(sandboxRoot, "worktrees-home");
			const runtimeHomePath = join(sandboxRoot, "runtime-home");
			const taskId = "task-delete-prune";
			mkdirSync(join(repoPath, ".git"), { recursive: true });
			mkdirSync(runtimeHomePath, { recursive: true });
			mkdirSync(worktreesHomePath, { recursive: true });

			workspaceStateMocks.getRuntimeHomePath.mockReturnValue(runtimeHomePath);
			workspaceStateMocks.getTaskWorktreesHomePath.mockReturnValue(worktreesHomePath);
			taskWorktreePathMocks.getWorkspaceFolderLabelForWorktreePath.mockReturnValue("repo");
			taskWorktreePathMocks.normalizeTaskIdForWorktreePath.mockImplementation((id: string) => id);

			const worktreePath = join(worktreesHomePath, taskId, "repo");
			mkdirSync(worktreePath, { recursive: true });
			writeFileSync(join(worktreePath, "README.md"), "stale\n", "utf8");

			const gitCommands: string[][] = [];
			childProcessMocks.execFilePromise.mockImplementation(
				async (_file: string, args: readonly string[], options?: ExecFileOptions) => {
					const { cwd, command } = getCommandArgs(args, options);
					gitCommands.push([cwd, ...command]);

					if (command[0] === "rev-parse" && command[1] === "--git-common-dir") {
						return { stdout: ".git\n", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "remove") {
						throw createGitError("fatal: working trees contain modified or untracked files");
					}
					if (command[0] === "worktree" && command[1] === "prune") {
						expect(existsSync(worktreePath)).toBe(false);
						return { stdout: "", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "list") {
						return { stdout: `worktree ${repoPath}\nHEAD abc\nbranch refs/heads/main\n`, stderr: "" };
					}
					throw createGitError(`Unhandled git command: ${command.join(" ")}`);
				},
			);

			const deleted = await deleteTaskWorktree({ repoPath, taskId });
			expect(deleted, JSON.stringify(deleted, null, 2)).toMatchObject({ ok: true, removed: true });
			expect(existsSync(worktreePath)).toBe(false);

			const pruneIndex = gitCommands.findIndex((command) => command[1] === "worktree" && command[2] === "prune");
			const removeIndex = gitCommands.findIndex((command) => command[1] === "worktree" && command[2] === "remove");
			expect(removeIndex).toBeGreaterThanOrEqual(0);
			expect(pruneIndex).toBeGreaterThan(removeIndex);
		} finally {
			cleanup();
		}
	});

	it("returns ok:false when git still lists the worktree after cleanup", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-delete-listed-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const worktreesHomePath = join(sandboxRoot, "worktrees-home");
			const runtimeHomePath = join(sandboxRoot, "runtime-home");
			const taskId = "task-still-listed";
			mkdirSync(join(repoPath, ".git"), { recursive: true });
			mkdirSync(runtimeHomePath, { recursive: true });
			mkdirSync(worktreesHomePath, { recursive: true });

			workspaceStateMocks.getRuntimeHomePath.mockReturnValue(runtimeHomePath);
			workspaceStateMocks.getTaskWorktreesHomePath.mockReturnValue(worktreesHomePath);
			taskWorktreePathMocks.getWorkspaceFolderLabelForWorktreePath.mockReturnValue("repo");
			taskWorktreePathMocks.normalizeTaskIdForWorktreePath.mockImplementation((id: string) => id);

			const worktreePath = join(worktreesHomePath, taskId, "repo");
			mkdirSync(worktreePath, { recursive: true });

			childProcessMocks.execFilePromise.mockImplementation(
				async (_file: string, args: readonly string[], options?: ExecFileOptions) => {
					const { command } = getCommandArgs(args, options);
					if (command[0] === "rev-parse" && command[1] === "--git-common-dir") {
						return { stdout: ".git\n", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "remove") {
						throw createGitError("fatal: cannot remove");
					}
					if (command[0] === "worktree" && command[1] === "prune") {
						return { stdout: "", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "list") {
						return {
							stdout: `worktree ${worktreePath}\nHEAD abc\ndetached\n`,
							stderr: "",
						};
					}
					throw createGitError(`Unhandled git command: ${command.join(" ")}`);
				},
			);

			const deleted = await deleteTaskWorktree({ repoPath, taskId });
			expect(deleted.ok).toBe(false);
			expect(deleted.removed).toBe(true);
			expect(deleted.error).toMatch(/still lists a worktree/i);
		} finally {
			cleanup();
		}
	});

	it("removes a linked worktree index.lock before git worktree remove", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-index-lock-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const worktreesHomePath = join(sandboxRoot, "worktrees-home");
			const runtimeHomePath = join(sandboxRoot, "runtime-home");
			const taskId = "task-index-lock";
			mkdirSync(join(repoPath, ".git", "worktrees", "repo"), { recursive: true });
			mkdirSync(runtimeHomePath, { recursive: true });
			mkdirSync(worktreesHomePath, { recursive: true });

			workspaceStateMocks.getRuntimeHomePath.mockReturnValue(runtimeHomePath);
			workspaceStateMocks.getTaskWorktreesHomePath.mockReturnValue(worktreesHomePath);
			taskWorktreePathMocks.getWorkspaceFolderLabelForWorktreePath.mockReturnValue("repo");
			taskWorktreePathMocks.normalizeTaskIdForWorktreePath.mockImplementation((id: string) => id);

			const worktreePath = join(worktreesHomePath, taskId, "repo");
			const linkedGitDir = join(repoPath, ".git", "worktrees", "repo");
			mkdirSync(worktreePath, { recursive: true });
			writeFileSync(join(worktreePath, ".git"), `gitdir: ${linkedGitDir}\n`, "utf8");
			writeFileSync(join(linkedGitDir, "commondir"), "../..\n", "utf8");
			const indexLockPath = join(linkedGitDir, "index.lock");
			writeFileSync(indexLockPath, "", "utf8");

			childProcessMocks.execFilePromise.mockImplementation(
				async (_file: string, args: readonly string[], options?: ExecFileOptions) => {
					const { command } = getCommandArgs(args, options);
					if (command[0] === "rev-parse" && command[1] === "--git-common-dir") {
						return { stdout: ".git\n", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "remove") {
						expect(existsSync(indexLockPath)).toBe(false);
						return { stdout: "", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "prune") {
						return { stdout: "", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "list") {
						return { stdout: `worktree ${repoPath}\nHEAD abc\nbranch refs/heads/main\n`, stderr: "" };
					}
					throw createGitError(`Unhandled git command: ${command.join(" ")}`);
				},
			);

			const deleted = await deleteTaskWorktree({ repoPath, taskId });
			expect(deleted.ok).toBe(true);
			expect(deleted.removed).toBe(true);
			expect(existsSync(indexLockPath)).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("serializes concurrent deletes of the same worktree through the setup lock", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-delete-lock-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const worktreesHomePath = join(sandboxRoot, "worktrees-home");
			const runtimeHomePath = join(sandboxRoot, "runtime-home");
			const taskId = "task-delete-lock";
			mkdirSync(join(repoPath, ".git"), { recursive: true });
			mkdirSync(runtimeHomePath, { recursive: true });
			mkdirSync(worktreesHomePath, { recursive: true });

			workspaceStateMocks.getRuntimeHomePath.mockReturnValue(runtimeHomePath);
			workspaceStateMocks.getTaskWorktreesHomePath.mockReturnValue(worktreesHomePath);
			taskWorktreePathMocks.getWorkspaceFolderLabelForWorktreePath.mockReturnValue("repo");
			taskWorktreePathMocks.normalizeTaskIdForWorktreePath.mockImplementation((id: string) => id);

			const worktreePath = join(worktreesHomePath, taskId, "repo");
			mkdirSync(worktreePath, { recursive: true });

			let activeRemoves = 0;
			let maxConcurrentRemoves = 0;
			childProcessMocks.execFilePromise.mockImplementation(
				async (_file: string, args: readonly string[], options?: ExecFileOptions) => {
					const { command } = getCommandArgs(args, options);
					if (command[0] === "rev-parse" && command[1] === "--git-common-dir") {
						return { stdout: ".git\n", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "remove") {
						activeRemoves += 1;
						maxConcurrentRemoves = Math.max(maxConcurrentRemoves, activeRemoves);
						await new Promise((resolve) => {
							setTimeout(resolve, 25);
						});
						activeRemoves -= 1;
						return { stdout: "", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "prune") {
						return { stdout: "", stderr: "" };
					}
					if (command[0] === "worktree" && command[1] === "list") {
						return { stdout: `worktree ${repoPath}\nHEAD abc\nbranch refs/heads/main\n`, stderr: "" };
					}
					throw createGitError(`Unhandled git command: ${command.join(" ")}`);
				},
			);

			const [first, second] = await Promise.all([
				deleteTaskWorktree({ repoPath, taskId }),
				deleteTaskWorktree({ repoPath, taskId }),
			]);
			expect(first.ok).toBe(true);
			expect(second.ok).toBe(true);
			expect(maxConcurrentRemoves).toBe(1);
		} finally {
			cleanup();
		}
	});
});
