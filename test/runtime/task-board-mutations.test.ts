import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import {
	addTaskDependency,
	addTaskToColumn,
	canAddTaskDependency,
	deleteTasksFromBoard,
	getUnfinishedPrerequisiteTaskIds,
	moveTaskToColumn,
	recordTaskVerifyResult,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
	updateTaskDependencies,
} from "../../src/core/task-board-mutations";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

describe("deleteTasksFromBoard", () => {
	it("removes a trashed task and any dependencies that reference it", () => {
		const createA = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task A", baseRef: "main" },
			() => "aaaaa111",
		);
		const createB = addTaskToColumn(createA.board, "review", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");
		const linked = addTaskDependency(createB.board, "aaaaa", "bbbbb");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}
		const trashed = trashTaskAndGetReadyLinkedTaskIds(linked.board, "bbbbb");
		const deleted = deleteTasksFromBoard(trashed.board, ["bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds).toEqual(["bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
		expect(deleted.board.dependencies).toEqual([]);
	});

	it("removes multiple trashed tasks at once", () => {
		const createA = addTaskToColumn(createBoard(), "trash", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
		const createB = addTaskToColumn(createA.board, "trash", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");

		const deleted = deleteTasksFromBoard(createB.board, ["aaaaa", "bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds.sort()).toEqual(["aaaaa", "bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
	});
});

describe("task images", () => {
	it("preserves images when creating and updating tasks", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task with image",
				baseRef: "main",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			},
			() => "aaaaa111",
		);

		expect(created.task.images).toEqual([
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task with updated image",
			baseRef: "main",
			images: [
				{
					id: "img-2",
					data: "def456",
					mimeType: "image/jpeg",
				},
			],
		});

		expect(updated.task?.images).toEqual([
			{
				id: "img-2",
				data: "def456",
				mimeType: "image/jpeg",
			},
		]);
	});
});

describe("per-task agent/model/provider overrides", () => {
	it("persists agentId on the card when creating a task", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Smart task", baseRef: "main", agentId: "claude" },
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBe("claude");
	});

	it("persists task-level agent settings on the card when creating a task", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Dumb task",
				baseRef: "main",
				agentId: "cline",
				agentSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "high",
				},
			},
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBe("cline");
		expect(created.task.agentSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "high",
		});
	});

	it("leaves override fields undefined when not provided", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Default task", baseRef: "main" },
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBeUndefined();
		expect(created.task.agentSettings).toBeUndefined();
	});

	it("updates agentId from undefined to a value", () => {
		const created = addTaskToColumn(createBoard(), "backlog", { prompt: "Task", baseRef: "main" }, () => "aaaaa111");
		expect(created.task.agentId).toBeUndefined();

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentId: "codex",
		});

		expect(updated.updated).toBe(true);
		expect(updated.task?.agentId).toBe("codex");
	});

	it("updates clineModelId", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main", agentSettings: { modelId: "old-model" } },
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentSettings: { modelId: "new-model" },
		});

		expect(updated.task?.agentSettings?.modelId).toBe("new-model");
	});

	it("preserves existing overrides when update input omits them (undefined)", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				agentId: "claude",
				agentSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "low",
				},
			},
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Updated prompt",
			baseRef: "main",
			// agentId and agentSettings are undefined, so existing overrides should persist
		});

		expect(updated.task?.agentId).toBe("claude");
		expect(updated.task?.agentSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "low",
		});
	});

	it("clears overrides when update input provides null", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				agentId: "codex",
				agentSettings: {
					providerId: "openai",
					modelId: "gpt-4",
					reasoningEffort: "medium",
				},
			},
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentId: null,
			agentSettings: null,
		});

		expect(updated.task?.agentId).toBeUndefined();
		expect(updated.task?.agentSettings).toBeUndefined();
	});

	it("preserves overrides across move operations", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Movable task",
				baseRef: "main",
				agentId: "claude",
				agentSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "high",
				},
			},
			() => "aaaaa111",
		);

		const moved = moveTaskToColumn(created.board, created.task.id, "in_progress");

		expect(moved.moved).toBe(true);
		expect(moved.task?.agentId).toBe("claude");
		expect(moved.task?.agentSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "high",
		});
	});
});

describe("task verification fields", () => {
	it("stores verifyCommand on create and leaves verifyResult unset", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main", verifyCommand: " npm test " },
			() => "aaaaa111",
		);

		expect(created.task.verifyCommand).toBe("npm test");
		expect(created.task.verifyResult).toBeUndefined();
	});

	it("leaves verify fields undefined when no command is provided", () => {
		const created = addTaskToColumn(createBoard(), "backlog", { prompt: "Task", baseRef: "main" }, () => "aaaaa111");

		expect(created.task.verifyCommand).toBeUndefined();
		expect(created.task.verifyResult).toBeUndefined();
	});

	it("records a verify result onto the card", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main", verifyCommand: "npm test" },
			() => "aaaaa111",
		);
		const recorded = recordTaskVerifyResult(created.board, created.task.id, {
			ok: true,
			output: "pass",
			recordedAt: 42,
		});

		expect(recorded.updated).toBe(true);
		expect(recorded.task?.verifyCommand).toBe("npm test");
		expect(recorded.task?.verifyResult).toEqual({
			ok: true,
			output: "pass",
			recordedAt: 42,
		});
	});

	it("preserves verifyResult when update omits the command", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main", verifyCommand: "npm test" },
			() => "aaaaa111",
		);
		const recorded = recordTaskVerifyResult(created.board, created.task.id, {
			ok: false,
			output: "fail",
			recordedAt: 7,
		});
		const updated = updateTask(recorded.board, created.task.id, {
			prompt: "Updated prompt",
			baseRef: "main",
		});

		expect(updated.task?.verifyCommand).toBe("npm test");
		expect(updated.task?.verifyResult).toEqual({
			ok: false,
			output: "fail",
			recordedAt: 7,
		});
	});

	it("clears verifyResult when the command changes", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main", verifyCommand: "npm test" },
			() => "aaaaa111",
		);
		const recorded = recordTaskVerifyResult(created.board, created.task.id, {
			ok: true,
			output: "pass",
			recordedAt: 7,
		});
		const updated = updateTask(recorded.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			verifyCommand: "npm run lint",
		});

		expect(updated.task?.verifyCommand).toBe("npm run lint");
		expect(updated.task?.verifyResult).toBeUndefined();
	});

	it("clears verify fields when update sets verifyCommand to null", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main", verifyCommand: "npm test" },
			() => "aaaaa111",
		);
		const recorded = recordTaskVerifyResult(created.board, created.task.id, {
			ok: true,
			recordedAt: 7,
		});
		const updated = updateTask(recorded.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			verifyCommand: null,
		});

		expect(updated.task?.verifyCommand).toBeUndefined();
		expect(updated.task?.verifyResult).toBeUndefined();
	});
});

describe("panel review card fields", () => {
	it("omits inherit by default and persists custom families", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				panelReviewMode: "custom",
				panelReviewFamilies: ["grok", "claude"],
			},
			() => "aaaaa111",
		);
		expect(created.task.panelReviewMode).toBe("custom");
		expect(created.task.panelReviewFamilies).toEqual(["grok", "claude"]);

		const inherited = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main" },
			() => "bbbbb111",
		);
		expect(inherited.task.panelReviewMode).toBeUndefined();
		expect(inherited.task.panelReviewFamilies).toBeUndefined();
	});

	it("preserves panel review when other fields update and can switch to off", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				panelReviewMode: "custom",
				panelReviewFamilies: ["gpt"],
			},
			() => "aaaaa111",
		);
		const preserved = updateTask(created.board, created.task.id, {
			prompt: "Updated",
			baseRef: "main",
		});
		expect(preserved.task?.panelReviewMode).toBe("custom");
		expect(preserved.task?.panelReviewFamilies).toEqual(["gpt"]);

		const turnedOff = updateTask(preserved.board, created.task.id, {
			prompt: "Updated",
			baseRef: "main",
			panelReviewMode: "off",
		});
		expect(turnedOff.task?.panelReviewMode).toBe("off");
		expect(turnedOff.task?.panelReviewFamilies).toBeUndefined();
	});
});

describe("AND dependency auto-start", () => {
	it("does not unlock a backlog card until every review prerequisite is done", () => {
		const createA = addTaskToColumn(createBoard(), "review", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
		const createB = addTaskToColumn(createA.board, "review", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");
		const createC = addTaskToColumn(
			createB.board,
			"backlog",
			{ prompt: "Task C", baseRef: "main" },
			() => "ccccc111",
		);
		const linkA = addTaskDependency(createC.board, "ccccc", "aaaaa");
		const linkB = addTaskDependency(linkA.board, "ccccc", "bbbbb");
		if (!linkA.added || !linkB.added) {
			throw new Error("Expected both dependencies to be created.");
		}

		expect(getUnfinishedPrerequisiteTaskIds(linkB.board, "ccccc")).toEqual(["aaaaa", "bbbbb"]);

		const trashA = trashTaskAndGetReadyLinkedTaskIds(linkB.board, "aaaaa");
		expect(trashA.moved).toBe(true);
		expect(trashA.readyTaskIds).toEqual([]);
		expect(getUnfinishedPrerequisiteTaskIds(trashA.board, "ccccc")).toEqual(["bbbbb"]);

		const trashB = trashTaskAndGetReadyLinkedTaskIds(trashA.board, "bbbbb");
		expect(trashB.moved).toBe(true);
		expect(trashB.readyTaskIds).toEqual(["ccccc"]);
		expect(getUnfinishedPrerequisiteTaskIds(trashB.board, "ccccc")).toEqual([]);
	});

	it("still unlocks a backlog card that has a single review prerequisite", () => {
		const createA = addTaskToColumn(createBoard(), "review", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
		const createC = addTaskToColumn(
			createA.board,
			"backlog",
			{ prompt: "Task C", baseRef: "main" },
			() => "ccccc111",
		);
		const linked = addTaskDependency(createC.board, "ccccc", "aaaaa");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}

		const trashA = trashTaskAndGetReadyLinkedTaskIds(linked.board, "aaaaa");
		expect(trashA.moved).toBe(true);
		expect(trashA.readyTaskIds).toEqual(["ccccc"]);
	});
});

describe("dependency link durability", () => {
	function createLinkedBacklogBoard(): RuntimeBoardData {
		const createA = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task A", baseRef: "main" },
			() => "aaaaa111",
		);
		const createB = addTaskToColumn(
			createA.board,
			"backlog",
			{ prompt: "Task B", baseRef: "main" },
			() => "bbbbb111",
		);
		const linked = addTaskDependency(createB.board, "aaaaa", "bbbbb");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}
		return linked.board;
	}

	it("keeps a link whose endpoints both left backlog", () => {
		const board = createLinkedBacklogBoard();
		const startedA = moveTaskToColumn(board, "aaaaa", "in_progress");
		const startedB = moveTaskToColumn(startedA.board, "bbbbb", "in_progress");

		// Both cards are active work, so the recorded relationship still holds. Dropping it here
		// permanently erased whole chains of links as tasks were started.
		expect(updateTaskDependencies(startedB.board).dependencies).toEqual([
			expect.objectContaining({ fromTaskId: "aaaaa", toTaskId: "bbbbb" }),
		]);
	});

	it("never reorients a stored link when the waiting task starts", () => {
		const board = createLinkedBacklogBoard();
		const startedA = moveTaskToColumn(board, "aaaaa", "in_progress");

		expect(updateTaskDependencies(startedA.board).dependencies).toEqual([
			expect.objectContaining({ fromTaskId: "aaaaa", toTaskId: "bbbbb" }),
		]);
		// Task B never waited on anything, so it must not become blocked.
		expect(getUnfinishedPrerequisiteTaskIds(startedA.board, "bbbbb")).toEqual([]);
		expect(getUnfinishedPrerequisiteTaskIds(startedA.board, "aaaaa")).toEqual(["bbbbb"]);
	});

	it("retires a link once an endpoint is done", () => {
		const board = createLinkedBacklogBoard();
		const doneB = moveTaskToColumn(board, "bbbbb", "trash");

		expect(updateTaskDependencies(doneB.board).dependencies).toEqual([]);
	});

	it("drops a link whose endpoint is no longer on the board", () => {
		const board = createLinkedBacklogBoard();
		const deleted = deleteTasksFromBoard(board, ["bbbbb"]);

		expect(updateTaskDependencies(deleted.board).dependencies).toEqual([]);
	});

	it("treats the reverse of an existing link as a duplicate", () => {
		const board = createLinkedBacklogBoard();

		expect(canAddTaskDependency(board, "bbbbb", "aaaaa")).toBe(false);
		const reverse = addTaskDependency(board, "bbbbb", "aaaaa");
		expect(reverse.added).toBe(false);
		expect(reverse.reason).toBe("duplicate");
	});

	it("refuses a link that would close a dependency loop", () => {
		const board = createLinkedBacklogBoard();
		const createC = addTaskToColumn(board, "backlog", { prompt: "Task C", baseRef: "main" }, () => "ccccc111");
		const linkBC = addTaskDependency(createC.board, "bbbbb", "ccccc");
		expect(linkBC.added).toBe(true);

		// A loop leaves every card in it permanently blocked and impossible to auto-start.
		expect(canAddTaskDependency(linkBC.board, "ccccc", "aaaaa")).toBe(false);
		const closing = addTaskDependency(linkBC.board, "ccccc", "aaaaa");
		expect(closing.added).toBe(false);
		expect(closing.reason).toBe("cycle");
		expect(closing.board.dependencies).toHaveLength(2);
	});
});
