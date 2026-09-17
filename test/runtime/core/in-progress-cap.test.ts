import { describe, expect, it } from "vitest";

import type { RuntimeBoardCard, RuntimeBoardData } from "../../../src/core/api-contract";
import {
	canStartAdditionalInProgressTask,
	DEFAULT_MAX_IN_PROGRESS_TASKS,
	formatInProgressCapError,
	getInProgressStartRefusal,
	getRemainingInProgressCapacity,
	normalizeMaxInProgressTasks,
	selectStartAllBacklogTaskIds,
} from "../../../src/core/in-progress-cap";

function createCard(id: string): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: id,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function createBoard({
	backlog = [],
	inProgress = [],
	review = [],
	trash = [],
	dependencies = [],
}: {
	backlog?: string[];
	inProgress?: string[];
	review?: string[];
	trash?: string[];
	dependencies?: RuntimeBoardData["dependencies"];
} = {}): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: backlog.map(createCard) },
			{ id: "in_progress", title: "In Progress", cards: inProgress.map(createCard) },
			{ id: "review", title: "Review", cards: review.map(createCard) },
			{ id: "trash", title: "Done", cards: trash.map(createCard) },
		],
		dependencies,
	};
}

describe("normalizeMaxInProgressTasks", () => {
	it("defaults missing or invalid values to 3", () => {
		expect(normalizeMaxInProgressTasks(undefined)).toBe(DEFAULT_MAX_IN_PROGRESS_TASKS);
		expect(normalizeMaxInProgressTasks(null)).toBe(3);
		expect(normalizeMaxInProgressTasks("3")).toBe(3);
		expect(normalizeMaxInProgressTasks(Number.NaN)).toBe(3);
	});

	it("clamps to a minimum of 1 and truncates fractions", () => {
		expect(normalizeMaxInProgressTasks(0)).toBe(1);
		expect(normalizeMaxInProgressTasks(-4)).toBe(1);
		expect(normalizeMaxInProgressTasks(4.9)).toBe(4);
		expect(normalizeMaxInProgressTasks(1)).toBe(1);
	});
});

describe("start refused at cap", () => {
	it("refuses starting a backlog card when In Progress is at the cap", () => {
		const board = createBoard({
			backlog: ["ready-1"],
			inProgress: ["active-1", "active-2", "active-3"],
		});

		expect(canStartAdditionalInProgressTask(board, 3, "ready-1")).toBe(false);
		expect(getInProgressStartRefusal(board, 3, "ready-1")).toBe(formatInProgressCapError(3));
		expect(getInProgressStartRefusal(board, 3, "ready-1")).toContain("maximum of 3 tasks");
	});

	it("allows restarting a card that is already in progress", () => {
		const board = createBoard({
			backlog: ["ready-1"],
			inProgress: ["active-1", "active-2", "active-3"],
		});

		expect(canStartAdditionalInProgressTask(board, 3, "active-2")).toBe(true);
		expect(getInProgressStartRefusal(board, 3, "active-2")).toBeNull();
	});

	it("allows starting when there is remaining capacity", () => {
		const board = createBoard({
			backlog: ["ready-1"],
			inProgress: ["active-1", "active-2"],
		});

		expect(getRemainingInProgressCapacity(board, 3)).toBe(1);
		expect(getInProgressStartRefusal(board, 3, "ready-1")).toBeNull();
	});
});

describe("start all fills remaining slots only", () => {
	it("starts only remaining ready backlog cards", () => {
		const board = createBoard({
			backlog: ["ready-1", "ready-2", "ready-3", "ready-4"],
			inProgress: ["active-1", "active-2"],
		});

		expect(selectStartAllBacklogTaskIds(board, 3)).toEqual(["ready-1"]);
	});

	it("prefers ready cards and skips blocked AND dependents", () => {
		const board = createBoard({
			backlog: ["blocked", "ready-1", "ready-2"],
			inProgress: ["active-1"],
			review: ["blocker"],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "blocker", createdAt: 1 }],
		});

		expect(selectStartAllBacklogTaskIds(board, 3)).toEqual(["ready-1", "ready-2"]);
	});

	it("returns no cards when already at capacity", () => {
		const board = createBoard({
			backlog: ["ready-1", "ready-2"],
			inProgress: ["active-1", "active-2", "active-3"],
		});

		expect(selectStartAllBacklogTaskIds(board, 3)).toEqual([]);
	});

	it("honors an explicit candidate list while still skipping blocked cards", () => {
		const board = createBoard({
			backlog: ["blocked", "ready-1", "ready-2", "ready-3"],
			inProgress: ["active-1", "active-2"],
			review: ["blocker"],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "blocker", createdAt: 1 }],
		});

		expect(selectStartAllBacklogTaskIds(board, 3, ["blocked", "ready-2", "ready-3"])).toEqual(["ready-2"]);
	});
});
