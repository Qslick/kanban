import { describe, expect, it } from "vitest";

import { getStartableBacklogTaskIds } from "@/hooks/use-task-start-actions";
import type { BoardCard, BoardData, BoardDependency } from "@/types";

describe("getStartableBacklogTaskIds", () => {
	function createCard(id: string, prompt = "Do something"): BoardCard {
		return {
			id,
			title: prompt,
			prompt,
			startInPlanMode: false,
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			baseRef: "main",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
	}

	function createBoard({
		backlogCards,
		dependencies = [],
		inProgressCards = [],
	}: {
		backlogCards: BoardCard[];
		dependencies?: BoardDependency[];
		inProgressCards?: BoardCard[];
	}): BoardData {
		return {
			columns: [
				{ id: "backlog", title: "Backlog", cards: backlogCards },
				{ id: "in_progress", title: "In Progress", cards: inProgressCards },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies,
		};
	}

	it("returns all backlog task ids when there are no dependencies", () => {
		const board = createBoard({ backlogCards: [createCard("task-1"), createCard("task-2"), createCard("task-3")] });
		expect(getStartableBacklogTaskIds(board)).toEqual(["task-1", "task-2", "task-3"]);
	});

	it("returns empty array when backlog is empty", () => {
		const board = createBoard({ backlogCards: [] });
		expect(getStartableBacklogTaskIds(board)).toEqual([]);
	});

	it("excludes a parent task whose child is also in the backlog", () => {
		const board = createBoard({
			backlogCards: [createCard("task-a"), createCard("task-b")],
			dependencies: [{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 }],
		});
		expect(getStartableBacklogTaskIds(board)).toEqual(["task-b"]);
	});

	it("excludes a parent task whose child is in progress", () => {
		const board = createBoard({
			backlogCards: [createCard("task-a")],
			dependencies: [{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 }],
			inProgressCards: [createCard("task-b")],
		});
		expect(getStartableBacklogTaskIds(board)).toEqual([]);
	});

	it("fills remaining in-progress slots and skips blocked AND dependents", () => {
		const board = createBoard({
			backlogCards: [createCard("blocked"), createCard("ready-1"), createCard("ready-2"), createCard("ready-3")],
			inProgressCards: [createCard("active-1"), createCard("active-2")],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "active-1", createdAt: 1 }],
		});
		expect(getStartableBacklogTaskIds(board, 3)).toEqual(["ready-1"]);
	});
});
