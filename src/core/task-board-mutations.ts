import type {
	RuntimeAgentId,
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimePanelReviewFamily,
	RuntimePanelReviewMode,
	RuntimeTaskAgentSettings,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskImage,
	RuntimeTaskPendingGitAction,
	RuntimeTaskVerifyResult,
} from "./api-contract";
import { clonePanelReviewFamilies, resolveTaskPanelReviewMode } from "./panel-review";
import { cloneRuntimeTaskAgentSettings } from "./task-agent-settings";
import { createUniqueTaskId } from "./task-id";
import { resolveTaskTitle } from "./task-title";
import { cloneVerifyResult, normalizeVerifyCommand } from "./task-verification";

/**
 * How long a persisted pending git action stays armed before it is treated as
 * stale. The agent commit/PR choreography takes minutes, so give it generous
 * headroom. Shared by every actor that reads the arming state: the runtime
 * auto-review reconciler and the browser.
 */
export const PENDING_GIT_ACTION_STALE_AFTER_MS = 15 * 60_000;

export function isPendingGitActionStale(pending: RuntimeTaskPendingGitAction, now: number = Date.now()): boolean {
	return now - pending.requestedAt > PENDING_GIT_ACTION_STALE_AFTER_MS;
}

export interface RuntimeCreateTaskInput {
	taskId?: string;
	title?: string;
	prompt: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: RuntimeTaskAutoReviewMode;
	images?: RuntimeTaskImage[];
	agentId?: RuntimeAgentId;
	agentSettings?: RuntimeTaskAgentSettings;
	panelReviewMode?: RuntimePanelReviewMode;
	panelReviewFamilies?: RuntimePanelReviewFamily[];
	baseRef: string;
	verifyCommand?: string;
}

export interface RuntimeUpdateTaskInput {
	title?: string;
	prompt: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: RuntimeTaskAutoReviewMode;
	images?: RuntimeTaskImage[];
	agentId?: RuntimeAgentId | null;
	agentSettings?: RuntimeTaskAgentSettings | null;
	panelReviewMode?: RuntimePanelReviewMode;
	panelReviewFamilies?: RuntimePanelReviewFamily[];
	baseRef: string;
	verifyCommand?: string | null;
}

function normalizeTaskAutoReviewMode(value: RuntimeTaskAutoReviewMode | null | undefined): RuntimeTaskAutoReviewMode {
	if (value === "pr") {
		return value;
	}
	return "commit";
}

function panelReviewPersistFields(input: {
	mode?: RuntimePanelReviewMode | null;
	families?: RuntimePanelReviewFamily[] | null;
}): {
	panelReviewMode?: RuntimePanelReviewMode;
	panelReviewFamilies?: RuntimePanelReviewFamily[];
} {
	const mode = resolveTaskPanelReviewMode(input.mode);
	if (mode === "inherit") {
		return {};
	}
	if (mode === "off") {
		return { panelReviewMode: "off" };
	}
	const families = clonePanelReviewFamilies(input.families ?? undefined);
	return {
		panelReviewMode: "custom",
		...(families.length > 0 ? { panelReviewFamilies: families } : {}),
	};
}

// Copy image metadata so board tasks do not retain caller-owned array or object references.
function cloneTaskImages(images?: RuntimeTaskImage[]): RuntimeTaskImage[] | undefined {
	return images && images.length > 0 ? images.map((image) => ({ ...image })) : undefined;
}

export interface RuntimeCreateTaskResult {
	board: RuntimeBoardData;
	task: RuntimeBoardCard;
}

export interface RuntimeMoveTaskResult {
	moved: boolean;
	board: RuntimeBoardData;
	task: RuntimeBoardCard | null;
	fromColumnId: RuntimeBoardColumnId | null;
}

export interface RuntimeUpdateTaskResult {
	board: RuntimeBoardData;
	task: RuntimeBoardCard | null;
	updated: boolean;
}

export interface RuntimeAddTaskDependencyResult {
	board: RuntimeBoardData;
	added: boolean;
	reason?: "missing_task" | "same_task" | "duplicate" | "trash_task" | "non_backlog" | "cycle";
	dependency?: RuntimeBoardDependency;
}

export interface RuntimeRemoveTaskDependencyResult {
	board: RuntimeBoardData;
	removed: boolean;
}

export interface RuntimeTrashTaskResult extends RuntimeMoveTaskResult {
	readyTaskIds: string[];
}

export interface RuntimeDeleteTasksResult {
	board: RuntimeBoardData;
	deleted: boolean;
	deletedTaskIds: string[];
}

function collectExistingTaskIds(board: RuntimeBoardData): Set<string> {
	const existingIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			existingIds.add(card.id);
		}
	}
	return existingIds;
}

function collectTaskIds(board: RuntimeBoardData): Set<string> {
	const taskIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			taskIds.add(card.id);
		}
	}
	return taskIds;
}

function createDependencyId(): string {
	return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

/**
 * Links are identified by the unordered pair of tasks they connect, so `A -> B` and `B -> A`
 * are the same link. Keeping the key unordered is what makes a reverse link a duplicate
 * instead of a two-task cycle that blocks both cards forever.
 */
function createDependencyPairKey(firstTaskId: string, secondTaskId: string): string {
	return firstTaskId <= secondTaskId ? `${firstTaskId}::${secondTaskId}` : `${secondTaskId}::${firstTaskId}`;
}

function hasDependencyPair(board: RuntimeBoardData, firstTaskId: string, secondTaskId: string): boolean {
	const pairKey = createDependencyPairKey(firstTaskId, secondTaskId);
	for (const dependency of board.dependencies) {
		if (createDependencyPairKey(dependency.fromTaskId.trim(), dependency.toTaskId.trim()) === pairKey) {
			return true;
		}
	}
	return false;
}

/**
 * True when making `waitingTaskId` wait on `prerequisiteTaskId` would close a loop, i.e. the
 * prerequisite already depends (transitively) on the waiting task. A loop leaves every card in
 * it permanently blocked and impossible to auto-start, so it is refused at creation time.
 */
function wouldCreateDependencyCycle(
	board: RuntimeBoardData,
	waitingTaskId: string,
	prerequisiteTaskId: string,
): boolean {
	if (board.dependencies.length === 0) {
		return false;
	}
	const prerequisitesByTaskId = new Map<string, string[]>();
	for (const dependency of board.dependencies) {
		const fromTaskId = dependency.fromTaskId.trim();
		const toTaskId = dependency.toTaskId.trim();
		if (!fromTaskId || !toTaskId) {
			continue;
		}
		const existing = prerequisitesByTaskId.get(fromTaskId);
		if (existing) {
			existing.push(toTaskId);
			continue;
		}
		prerequisitesByTaskId.set(fromTaskId, [toTaskId]);
	}
	const pending = [prerequisiteTaskId];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const taskId = pending.pop();
		if (!taskId || visited.has(taskId)) {
			continue;
		}
		if (taskId === waitingTaskId) {
			return true;
		}
		visited.add(taskId);
		for (const nextTaskId of prerequisitesByTaskId.get(taskId) ?? []) {
			pending.push(nextTaskId);
		}
	}
	return false;
}

function findTaskLocation(
	board: RuntimeBoardData,
	taskId: string,
): {
	columnIndex: number;
	taskIndex: number;
	columnId: RuntimeBoardColumnId;
	task: RuntimeBoardCard;
} | null {
	for (const [columnIndex, column] of board.columns.entries()) {
		const taskIndex = column.cards.findIndex((card) => card.id === taskId);
		if (taskIndex === -1) {
			continue;
		}
		const task = column.cards[taskIndex];
		if (!task) {
			continue;
		}
		return {
			columnIndex,
			taskIndex,
			columnId: column.id,
			task,
		};
	}
	return null;
}

/**
 * Creation-time gate only. Never call this while normalizing a stored board: it rejects pairs
 * whose endpoints have since left Backlog, and it reorients the pair, so running it over stored
 * links deletes and inverts them. See `updateTaskDependencies`.
 */
function resolveDependencyEndpoints(
	board: RuntimeBoardData,
	firstTaskId: string,
	secondTaskId: string,
):
	| {
			backlogTaskId: string;
			linkedTaskId: string;
	  }
	| { reason: RuntimeAddTaskDependencyResult["reason"] } {
	const firstColumnId = getTaskColumnId(board, firstTaskId);
	const secondColumnId = getTaskColumnId(board, secondTaskId);
	if (!firstColumnId || !secondColumnId) {
		return { reason: "missing_task" };
	}
	if (firstColumnId === "trash" || secondColumnId === "trash") {
		return { reason: "trash_task" };
	}
	const firstIsBacklog = firstColumnId === "backlog";
	const secondIsBacklog = secondColumnId === "backlog";
	if (firstIsBacklog && secondIsBacklog) {
		return {
			backlogTaskId: firstTaskId,
			linkedTaskId: secondTaskId,
		};
	}
	if (!firstIsBacklog && !secondIsBacklog) {
		return { reason: "non_backlog" };
	}
	return firstIsBacklog
		? { backlogTaskId: firstTaskId, linkedTaskId: secondTaskId }
		: { backlogTaskId: secondTaskId, linkedTaskId: firstTaskId };
}

function getLinkedBacklogTaskIdsReadyAfterTaskTrashed(
	board: RuntimeBoardData,
	taskId: string,
	fromColumnId: RuntimeBoardColumnId | null,
): string[] {
	if (!taskId || board.dependencies.length === 0 || fromColumnId !== "review") {
		return [];
	}
	const readyTaskIds = new Set<string>();
	for (const dependency of board.dependencies) {
		if (dependency.toTaskId !== taskId) {
			continue;
		}
		if (getTaskColumnId(board, dependency.fromTaskId) !== "backlog") {
			continue;
		}
		const remainingUnfinished = getUnfinishedPrerequisiteTaskIds(board, dependency.fromTaskId).filter(
			(prereqId) => prereqId !== taskId,
		);
		if (remainingUnfinished.length === 0) {
			readyTaskIds.add(dependency.fromTaskId);
		}
	}
	return [...readyTaskIds];
}

/**
 * Normalizes stored links. This runs on every board read on both the server
 * (`readWorkspaceBoard`) and the client (`normalizeBoardData`), and the result is what gets
 * persisted, so anything dropped here is gone for good and any reorientation here silently
 * rewrites what the user drew.
 *
 * It therefore retires a link only when it can no longer mean anything — an endpoint has left
 * the board, or an endpoint reached Done, which is the link's normal end of life. It must never
 * drop a link just because both endpoints left Backlog (both cards are still active work and
 * the relationship still holds), and it must never change a link's direction. Column rules that
 * decide whether a link may be *created* belong in `resolveDependencyEndpoints`.
 */
export function updateTaskDependencies(board: RuntimeBoardData): RuntimeBoardData {
	if (board.dependencies.length === 0) {
		return board;
	}
	const taskIds = collectTaskIds(board);
	const dependencies: RuntimeBoardDependency[] = [];
	const existingPairs = new Set<string>();
	for (const dependency of board.dependencies) {
		const fromTaskId = dependency.fromTaskId.trim();
		const toTaskId = dependency.toTaskId.trim();
		if (!fromTaskId || !toTaskId || fromTaskId === toTaskId) {
			continue;
		}
		if (!taskIds.has(fromTaskId) || !taskIds.has(toTaskId)) {
			continue;
		}
		if (getTaskColumnId(board, fromTaskId) === "trash" || getTaskColumnId(board, toTaskId) === "trash") {
			continue;
		}
		const pairKey = createDependencyPairKey(fromTaskId, toTaskId);
		if (existingPairs.has(pairKey)) {
			continue;
		}
		existingPairs.add(pairKey);
		dependencies.push({
			id: dependency.id,
			fromTaskId,
			toTaskId,
			createdAt: dependency.createdAt,
		});
	}
	if (
		dependencies.length === board.dependencies.length &&
		dependencies.every((dependency, index) => {
			const current = board.dependencies[index];
			return (
				current &&
				current.id === dependency.id &&
				current.fromTaskId === dependency.fromTaskId &&
				current.toTaskId === dependency.toTaskId &&
				current.createdAt === dependency.createdAt
			);
		})
	) {
		return board;
	}
	return {
		...board,
		dependencies,
	};
}

export function addTaskToColumn(
	board: RuntimeBoardData,
	columnId: RuntimeBoardColumnId,
	input: RuntimeCreateTaskInput,
	randomUuid: () => string,
	now: number = Date.now(),
): RuntimeCreateTaskResult {
	const prompt = input.prompt.trim();
	if (!prompt) {
		throw new Error("Task prompt is required.");
	}
	const baseRef = input.baseRef.trim();
	if (!baseRef) {
		throw new Error("Task baseRef is required.");
	}
	const existingIds = collectExistingTaskIds(board);
	const explicitTaskId = input.taskId?.trim();
	if (explicitTaskId && existingIds.has(explicitTaskId)) {
		throw new Error(`Task "${explicitTaskId}" already exists.`);
	}
	const verifyCommand = normalizeVerifyCommand(input.verifyCommand);
	const task: RuntimeBoardCard = {
		id: explicitTaskId || createUniqueTaskId(existingIds, randomUuid),
		title: resolveTaskTitle(input.title, prompt),
		prompt,
		startInPlanMode: Boolean(input.startInPlanMode),
		autoReviewEnabled: Boolean(input.autoReviewEnabled),
		autoReviewMode: normalizeTaskAutoReviewMode(input.autoReviewMode),
		images: cloneTaskImages(input.images),
		...(input.agentId ? { agentId: input.agentId } : {}),
		...(input.agentSettings !== undefined
			? { agentSettings: cloneRuntimeTaskAgentSettings(input.agentSettings) }
			: {}),
		...panelReviewPersistFields({
			mode: input.panelReviewMode,
			families: input.panelReviewFamilies,
		}),
		baseRef,
		...(verifyCommand ? { verifyCommand } : {}),
		createdAt: now,
		updatedAt: now,
	};

	const targetColumnIndex = board.columns.findIndex((column) => column.id === columnId);
	if (targetColumnIndex === -1) {
		throw new Error(`Column ${columnId} not found.`);
	}

	const columns = board.columns.map((column, index) => {
		if (index !== targetColumnIndex) {
			return column;
		}
		return {
			...column,
			cards: [task, ...column.cards],
		};
	});

	return {
		board: {
			...board,
			columns,
		},
		task,
	};
}

export function getTaskColumnId(board: RuntimeBoardData, taskId: string): RuntimeBoardColumnId | null {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return null;
	}
	const found = findTaskLocation(board, normalizedTaskId);
	return found ? found.columnId : null;
}

/** Prerequisite IDs that still block `taskId` (everything except Done/trash). */
export function getUnfinishedPrerequisiteTaskIds(board: RuntimeBoardData, taskId: string): string[] {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId || board.dependencies.length === 0) {
		return [];
	}
	const unfinished: string[] = [];
	const seen = new Set<string>();
	for (const dependency of board.dependencies) {
		if (dependency.fromTaskId !== normalizedTaskId) {
			continue;
		}
		const prereqId = dependency.toTaskId.trim();
		if (!prereqId || seen.has(prereqId)) {
			continue;
		}
		if (getTaskColumnId(board, prereqId) === "trash") {
			continue;
		}
		seen.add(prereqId);
		unfinished.push(prereqId);
	}
	return unfinished;
}

export function addTaskDependency(
	board: RuntimeBoardData,
	firstTaskId: string,
	secondTaskId: string,
): RuntimeAddTaskDependencyResult {
	const normalizedFirstTaskId = firstTaskId.trim();
	const normalizedSecondTaskId = secondTaskId.trim();
	if (!normalizedFirstTaskId || !normalizedSecondTaskId) {
		return { board, added: false, reason: "missing_task" };
	}
	if (normalizedFirstTaskId === normalizedSecondTaskId) {
		return { board, added: false, reason: "same_task" };
	}
	const resolved = resolveDependencyEndpoints(board, normalizedFirstTaskId, normalizedSecondTaskId);
	if ("reason" in resolved) {
		return { board, added: false, reason: resolved.reason };
	}
	if (hasDependencyPair(board, resolved.backlogTaskId, resolved.linkedTaskId)) {
		return { board, added: false, reason: "duplicate" };
	}
	if (wouldCreateDependencyCycle(board, resolved.backlogTaskId, resolved.linkedTaskId)) {
		return { board, added: false, reason: "cycle" };
	}
	const dependency: RuntimeBoardDependency = {
		id: createDependencyId(),
		fromTaskId: resolved.backlogTaskId,
		toTaskId: resolved.linkedTaskId,
		createdAt: Date.now(),
	};
	return {
		board: {
			...board,
			dependencies: [...board.dependencies, dependency],
		},
		added: true,
		dependency,
	};
}

export function canAddTaskDependency(board: RuntimeBoardData, firstTaskId: string, secondTaskId: string): boolean {
	const normalizedFirstTaskId = firstTaskId.trim();
	const normalizedSecondTaskId = secondTaskId.trim();
	if (!normalizedFirstTaskId || !normalizedSecondTaskId || normalizedFirstTaskId === normalizedSecondTaskId) {
		return false;
	}
	const resolved = resolveDependencyEndpoints(board, normalizedFirstTaskId, normalizedSecondTaskId);
	if ("reason" in resolved) {
		return false;
	}
	if (hasDependencyPair(board, resolved.backlogTaskId, resolved.linkedTaskId)) {
		return false;
	}
	return !wouldCreateDependencyCycle(board, resolved.backlogTaskId, resolved.linkedTaskId);
}

export function removeTaskDependency(board: RuntimeBoardData, dependencyId: string): RuntimeRemoveTaskDependencyResult {
	const dependencies = board.dependencies.filter((dependency) => dependency.id !== dependencyId);
	if (dependencies.length === board.dependencies.length) {
		return { board, removed: false };
	}
	return {
		board: {
			...board,
			dependencies,
		},
		removed: true,
	};
}

export function getReadyLinkedTaskIdsForTaskInTrash(board: RuntimeBoardData, taskId: string): string[] {
	return getLinkedBacklogTaskIdsReadyAfterTaskTrashed(board, taskId, getTaskColumnId(board, taskId));
}

export function trashTaskAndGetReadyLinkedTaskIds(
	board: RuntimeBoardData,
	taskId: string,
	now: number = Date.now(),
): RuntimeTrashTaskResult {
	const fromColumnId = getTaskColumnId(board, taskId);
	const readyTaskIds = getLinkedBacklogTaskIdsReadyAfterTaskTrashed(board, taskId, fromColumnId);
	const movedToTrash = moveTaskToColumn(board, taskId, "trash", now);
	return {
		...movedToTrash,
		readyTaskIds: movedToTrash.moved ? readyTaskIds : [],
	};
}

export function deleteTasksFromBoard(board: RuntimeBoardData, taskIds: Iterable<string>): RuntimeDeleteTasksResult {
	const normalizedTaskIds = new Set(
		Array.from(taskIds, (taskId) => taskId.trim()).filter((taskId) => taskId.length > 0),
	);
	if (normalizedTaskIds.size === 0) {
		return {
			board,
			deleted: false,
			deletedTaskIds: [],
		};
	}

	const deletedTaskIds: string[] = [];
	const columns = board.columns.map((column) => {
		const remainingCards = column.cards.filter((card) => {
			if (!normalizedTaskIds.has(card.id)) {
				return true;
			}
			deletedTaskIds.push(card.id);
			return false;
		});
		return remainingCards.length === column.cards.length ? column : { ...column, cards: remainingCards };
	});

	if (deletedTaskIds.length === 0) {
		return {
			board,
			deleted: false,
			deletedTaskIds: [],
		};
	}

	const deletedTaskIdSet = new Set(deletedTaskIds);
	const dependencies = board.dependencies.filter(
		(dependency) => !deletedTaskIdSet.has(dependency.fromTaskId) && !deletedTaskIdSet.has(dependency.toTaskId),
	);

	return {
		board: {
			...board,
			columns,
			dependencies,
		},
		deleted: true,
		deletedTaskIds,
	};
}

export function moveTaskToColumn(
	board: RuntimeBoardData,
	taskId: string,
	targetColumnId: RuntimeBoardColumnId,
	now: number = Date.now(),
): RuntimeMoveTaskResult {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return {
			moved: false,
			board,
			task: null,
			fromColumnId: null,
		};
	}

	const found = findTaskLocation(board, normalizedTaskId);
	if (!found) {
		return {
			moved: false,
			board,
			task: null,
			fromColumnId: null,
		};
	}
	if (found.columnId === targetColumnId) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}
	const targetColumnIndex = board.columns.findIndex((column) => column.id === targetColumnId);
	if (targetColumnIndex === -1) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}

	const sourceColumn = board.columns[found.columnIndex];
	const targetColumn = board.columns[targetColumnIndex];
	if (!sourceColumn || !targetColumn) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}

	const sourceCards = [...sourceColumn.cards];
	const [task] = sourceCards.splice(found.taskIndex, 1);
	if (!task) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}
	const movedTask: RuntimeBoardCard = {
		...task,
		updatedAt: now,
	};
	const targetCards =
		targetColumnId === "trash" ? [movedTask, ...targetColumn.cards] : [...targetColumn.cards, movedTask];

	const columns = board.columns.map((column, index) => {
		if (index === found.columnIndex) {
			return {
				...column,
				cards: sourceCards,
			};
		}
		if (index === targetColumnIndex) {
			return {
				...column,
				cards: targetCards,
			};
		}
		return column;
	});

	return {
		moved: true,
		board: updateTaskDependencies({
			...board,
			columns,
		}),
		task: movedTask,
		fromColumnId: found.columnId,
	};
}

export function updateTask(
	board: RuntimeBoardData,
	taskId: string,
	input: RuntimeUpdateTaskInput,
	now: number = Date.now(),
): RuntimeUpdateTaskResult {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	const prompt = input.prompt.trim();
	if (!prompt) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	const baseRef = input.baseRef.trim();
	if (!baseRef) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	let updatedTask: RuntimeBoardCard | null = null;
	const columns = board.columns.map((column) => {
		let columnUpdated = false;
		const cards = column.cards.map((card) => {
			if (card.id !== normalizedTaskId) {
				return card;
			}
			columnUpdated = true;
			const nextVerifyCommand =
				input.verifyCommand === undefined
					? normalizeVerifyCommand(card.verifyCommand)
					: normalizeVerifyCommand(input.verifyCommand);
			const verifyCommandUnchanged = nextVerifyCommand === normalizeVerifyCommand(card.verifyCommand);
			const nextTask: RuntimeBoardCard = {
				...card,
				title: resolveTaskTitle(input.title, prompt),
				prompt,
				startInPlanMode: Boolean(input.startInPlanMode),
				autoReviewEnabled: Boolean(input.autoReviewEnabled),
				autoReviewMode: normalizeTaskAutoReviewMode(input.autoReviewMode),
				images: input.images === undefined ? card.images : cloneTaskImages(input.images),
				agentId: input.agentId === undefined ? card.agentId : (input.agentId ?? undefined),
				agentSettings:
					input.agentSettings === undefined
						? cloneRuntimeTaskAgentSettings(card.agentSettings)
						: input.agentSettings === null
							? undefined
							: cloneRuntimeTaskAgentSettings(input.agentSettings),
				baseRef,
				verifyCommand: nextVerifyCommand,
				verifyResult: verifyCommandUnchanged ? cloneVerifyResult(card.verifyResult) : undefined,
				updatedAt: now,
			};
			if (input.panelReviewMode !== undefined || input.panelReviewFamilies !== undefined) {
				const { panelReviewMode: _mode, panelReviewFamilies: _families, ...withoutPanelReview } = nextTask;
				updatedTask = {
					...withoutPanelReview,
					...panelReviewPersistFields({
						mode: input.panelReviewMode ?? card.panelReviewMode,
						families: input.panelReviewFamilies ?? card.panelReviewFamilies,
					}),
				};
			} else {
				updatedTask = nextTask;
			}
			return updatedTask;
		});
		return columnUpdated ? { ...column, cards } : column;
	});

	if (!updatedTask) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	return {
		board: {
			...board,
			columns,
		},
		task: updatedTask,
		updated: true,
	};
}

export function recordTaskVerifyResult(
	board: RuntimeBoardData,
	taskId: string,
	result: RuntimeTaskVerifyResult,
	now: number = Date.now(),
): RuntimeUpdateTaskResult {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	let updatedTask: RuntimeBoardCard | null = null;
	const columns = board.columns.map((column) => {
		let columnUpdated = false;
		const cards = column.cards.map((card) => {
			if (card.id !== normalizedTaskId) {
				return card;
			}
			columnUpdated = true;
			updatedTask = {
				...card,
				verifyResult: cloneVerifyResult(result),
				updatedAt: now,
			};
			return updatedTask;
		});
		return columnUpdated ? { ...column, cards } : column;
	});

	if (!updatedTask) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	return {
		board: {
			...board,
			columns,
		},
		task: updatedTask,
		updated: true,
	};
}
