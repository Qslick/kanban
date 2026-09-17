import type { RuntimeBoardData } from "./api-contract";
import { getTaskColumnId, getUnfinishedPrerequisiteTaskIds } from "./task-board-mutations";

export const DEFAULT_MAX_IN_PROGRESS_TASKS = 3;
export const MIN_MAX_IN_PROGRESS_TASKS = 1;

export function normalizeMaxInProgressTasks(value: unknown, fallback: number = DEFAULT_MAX_IN_PROGRESS_TASKS): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(MIN_MAX_IN_PROGRESS_TASKS, Math.trunc(value));
}

export function countInProgressTasks(board: RuntimeBoardData): number {
	return board.columns.find((column) => column.id === "in_progress")?.cards.length ?? 0;
}

export function getRemainingInProgressCapacity(board: RuntimeBoardData, maxInProgressTasks: number): number {
	return Math.max(0, normalizeMaxInProgressTasks(maxInProgressTasks) - countInProgressTasks(board));
}

export function formatInProgressCapError(maxInProgressTasks: number): string {
	const max = normalizeMaxInProgressTasks(maxInProgressTasks);
	const taskWord = max === 1 ? "task" : "tasks";
	return `Cannot start another task. In Progress already has the maximum of ${max} ${taskWord}. Finish or move a running task first.`;
}

export function canStartAdditionalInProgressTask(
	board: RuntimeBoardData,
	maxInProgressTasks: number,
	taskId?: string,
): boolean {
	if (taskId && getTaskColumnId(board, taskId) === "in_progress") {
		return true;
	}
	return getRemainingInProgressCapacity(board, maxInProgressTasks) > 0;
}

export function getInProgressStartRefusal(
	board: RuntimeBoardData,
	maxInProgressTasks: number,
	taskId: string,
): string | null {
	if (canStartAdditionalInProgressTask(board, maxInProgressTasks, taskId)) {
		return null;
	}
	return formatInProgressCapError(maxInProgressTasks);
}

export function selectStartAllBacklogTaskIds(
	board: RuntimeBoardData,
	maxInProgressTasks: number,
	candidateTaskIds?: readonly string[],
): string[] {
	const remaining = getRemainingInProgressCapacity(board, maxInProgressTasks);
	if (remaining <= 0) {
		return [];
	}

	const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards ?? [];
	const backlogIds = new Set(backlogCards.map((card) => card.id));
	const orderedCandidates = candidateTaskIds
		? candidateTaskIds.filter((taskId) => taskId.trim().length > 0 && backlogIds.has(taskId))
		: backlogCards.map((card) => card.id);

	const selected: string[] = [];
	const seen = new Set<string>();
	for (const taskId of orderedCandidates) {
		if (seen.has(taskId)) {
			continue;
		}
		seen.add(taskId);
		if (getUnfinishedPrerequisiteTaskIds(board, taskId).length > 0) {
			continue;
		}
		selected.push(taskId);
		if (selected.length >= remaining) {
			break;
		}
	}
	return selected;
}
