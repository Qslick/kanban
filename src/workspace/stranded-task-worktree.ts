import type {
	RuntimeTaskSessionState,
	RuntimeTaskWorktreeDiscardResponse,
	RuntimeTaskWorktreeKeepResponse,
	RuntimeTaskWorktreeStatusResponse,
} from "../core/api-contract";
import { runGit } from "./git-utils";
import { deleteTaskWorktree, getTaskWorkspaceInfo, getTaskWorkspacePathInfo } from "./task-worktree";
import { normalizeTaskIdForWorktreePath } from "./task-worktree-path";

export const RECOVERED_TASK_BRANCH_PREFIX = "recovered/";
const HEAD_SHORT_SHA_LENGTH = 8;

export function buildRecoveredTaskBranchName(taskId: string): string {
	return `${RECOVERED_TASK_BRANCH_PREFIX}${normalizeTaskIdForWorktreePath(taskId)}`;
}

export function toHeadShortSha(headCommit: string | null): string | null {
	if (!headCommit) {
		return null;
	}
	return headCommit.slice(0, HEAD_SHORT_SHA_LENGTH);
}

export function isLiveTaskSessionState(state: RuntimeTaskSessionState | null | undefined): boolean {
	return state === "running" || state === "awaiting_review";
}

export function isStrandedTaskWorktree(options: {
	exists: boolean;
	cardOnBoard: boolean;
	sessionState: RuntimeTaskSessionState | null | undefined;
}): boolean {
	return options.exists && options.cardOnBoard && !isLiveTaskSessionState(options.sessionState);
}

export function formatUnreachableDiscardError(taskId: string): string {
	return `HEAD is not reachable from any branch or tag. Keep first to preserve it on ${buildRecoveredTaskBranchName(taskId)}.`;
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
	const result = await runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);
	return result.ok;
}

export async function isCommitReachableFromBranchesOrTags(cwd: string, commit: string): Promise<boolean> {
	const result = await runGit(cwd, [
		"for-each-ref",
		`--contains=${commit}`,
		"--format=%(refname)",
		"refs/heads",
		"refs/tags",
	]);
	return result.ok && result.stdout.length > 0;
}

function createMissingWorktreeStatus(options: {
	taskId: string;
	path: string;
	sessionState: RuntimeTaskSessionState | null;
	recoveredBranch: string;
}): RuntimeTaskWorktreeStatusResponse {
	return {
		taskId: options.taskId,
		path: options.path,
		exists: false,
		stranded: false,
		sessionState: options.sessionState,
		headCommit: null,
		headShortSha: null,
		reachable: true,
		recoveredBranch: options.recoveredBranch,
		recoveredBranchExists: false,
		canDiscard: false,
	};
}

export async function inspectStrandedTaskWorktree(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
	sessionState: RuntimeTaskSessionState | null;
	cardOnBoard: boolean;
}): Promise<RuntimeTaskWorktreeStatusResponse> {
	const pathInfo = await getTaskWorkspacePathInfo({
		cwd: options.cwd,
		taskId: options.taskId,
		baseRef: options.baseRef,
	});
	const recoveredBranch = buildRecoveredTaskBranchName(pathInfo.taskId);
	if (!pathInfo.exists) {
		return createMissingWorktreeStatus({
			taskId: pathInfo.taskId,
			path: pathInfo.path,
			sessionState: options.sessionState,
			recoveredBranch,
		});
	}

	const info = await getTaskWorkspaceInfo({
		cwd: options.cwd,
		taskId: options.taskId,
		baseRef: options.baseRef,
	});
	const headCommit = info.headCommit;
	const recoveredBranchExists = await refExists(info.path, `refs/heads/${recoveredBranch}`);
	const reachable = headCommit === null ? true : await isCommitReachableFromBranchesOrTags(info.path, headCommit);
	const live = isLiveTaskSessionState(options.sessionState);
	return {
		taskId: info.taskId,
		path: info.path,
		exists: true,
		stranded: isStrandedTaskWorktree({
			exists: true,
			cardOnBoard: options.cardOnBoard,
			sessionState: options.sessionState,
		}),
		sessionState: options.sessionState,
		headCommit,
		headShortSha: toHeadShortSha(headCommit),
		reachable,
		recoveredBranch,
		recoveredBranchExists,
		canDiscard: reachable && !live,
	};
}

export async function keepStrandedTaskWorktree(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
}): Promise<RuntimeTaskWorktreeKeepResponse> {
	const info = await getTaskWorkspaceInfo({
		cwd: options.cwd,
		taskId: options.taskId,
		baseRef: options.baseRef,
	});
	const branch = buildRecoveredTaskBranchName(info.taskId);
	if (!info.exists) {
		return {
			ok: false,
			branch,
			headCommit: null,
			created: false,
			error: "Task worktree not found.",
		};
	}
	if (!info.headCommit) {
		return {
			ok: false,
			branch,
			headCommit: null,
			created: false,
			error: "Task worktree has no HEAD commit to keep.",
		};
	}

	const existed = await refExists(info.path, `refs/heads/${branch}`);
	const result = await runGit(
		info.path,
		existed ? ["branch", "-f", branch, info.headCommit] : ["branch", branch, info.headCommit],
	);
	if (!result.ok) {
		return {
			ok: false,
			branch,
			headCommit: info.headCommit,
			created: false,
			error: result.stderr || result.error || "Could not create recovered branch.",
		};
	}
	return {
		ok: true,
		branch,
		headCommit: info.headCommit,
		created: !existed,
	};
}

export async function discardStrandedTaskWorktree(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
	sessionState: RuntimeTaskSessionState | null;
}): Promise<RuntimeTaskWorktreeDiscardResponse> {
	if (isLiveTaskSessionState(options.sessionState)) {
		return {
			ok: false,
			removed: false,
			refused: true,
			error: "Cannot discard a worktree while the task session is running.",
		};
	}

	const status = await inspectStrandedTaskWorktree({
		cwd: options.cwd,
		taskId: options.taskId,
		baseRef: options.baseRef,
		sessionState: options.sessionState,
		cardOnBoard: true,
	});
	if (!status.exists) {
		return {
			ok: true,
			removed: false,
			refused: false,
		};
	}
	if (!status.reachable) {
		return {
			ok: false,
			removed: false,
			refused: true,
			error: formatUnreachableDiscardError(status.taskId),
		};
	}

	const deleted = await deleteTaskWorktree({
		repoPath: options.cwd,
		taskId: status.taskId,
	});
	return {
		ok: deleted.ok,
		removed: deleted.removed,
		refused: false,
		error: deleted.error,
	};
}
