import { describe, expect, it } from "vitest";

import { getReadyNowBacklogCards, isTaskReadyNow, remapBacklogDragSourceIndex } from "@/state/ready-now";
import type { BoardCard, BoardData, BoardDependency } from "@/types";

function createCard(id: string, prompt = id): BoardCard {
	return {
		id,
		title: prompt,
		prompt,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function createBoard({
	backlogCards = [],
	inProgressCards = [],
	reviewCards = [],
	trashCards = [],
	dependencies = [],
}: {
	backlogCards?: BoardCard[];
	inProgressCards?: BoardCard[];
	reviewCards?: BoardCard[];
	trashCards?: BoardCard[];
	dependencies?: BoardDependency[];
} = {}): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: backlogCards },
			{ id: "in_progress", title: "In Progress", cards: inProgressCards },
			{ id: "review", title: "Review", cards: reviewCards },
			{ id: "trash", title: "Done", cards: trashCards },
		],
		dependencies,
	};
}

describe("isTaskReadyNow", () => {
	it("treats a card with no dependencies as ready", () => {
		const board = createBoard({
			backlogCards: [createCard("task-a"), createCard("task-b")],
		});

		expect(isTaskReadyNow(board, "task-a")).toBe(true);
		expect(getReadyNowBacklogCards(board).map((card) => card.id)).toEqual(["task-a", "task-b"]);
	});

	it("treats a card with one unfinished blocker as not ready", () => {
		const board = createBoard({
			backlogCards: [createCard("task-a")],
			reviewCards: [createCard("task-b")],
			dependencies: [{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 }],
		});

		expect(isTaskReadyNow(board, "task-a")).toBe(false);
		expect(getReadyNowBacklogCards(board)).toEqual([]);
	});

	it("treats a card as ready when every blocker is in trash", () => {
		const board = createBoard({
			backlogCards: [createCard("task-a")],
			trashCards: [createCard("task-b"), createCard("task-c")],
			dependencies: [
				{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 },
				{ id: "dep-2", fromTaskId: "task-a", toTaskId: "task-c", createdAt: 2 },
			],
		});

		expect(isTaskReadyNow(board, "task-a")).toBe(true);
		expect(getReadyNowBacklogCards(board).map((card) => card.id)).toEqual(["task-a"]);
	});

	it("keeps a card blocked when any prerequisite is still unfinished", () => {
		const board = createBoard({
			backlogCards: [createCard("task-a")],
			reviewCards: [createCard("task-b")],
			trashCards: [createCard("task-c")],
			dependencies: [
				{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 },
				{ id: "dep-2", fromTaskId: "task-a", toTaskId: "task-c", createdAt: 2 },
			],
		});

		expect(isTaskReadyNow(board, "task-a")).toBe(false);
	});
});

describe("remapBacklogDragSourceIndex", () => {
	it("maps a filtered visible index back to the unfiltered backlog index", () => {
		const board = createBoard({
			backlogCards: [createCard("blocked"), createCard("ready")],
			reviewCards: [createCard("prereq")],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "prereq", createdAt: 1 }],
		});

		expect(remapBacklogDragSourceIndex(board, "ready", 0)).toBe(1);
	});
});
