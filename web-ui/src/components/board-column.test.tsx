import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardColumn } from "@/components/board-column";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isTaskReadyNow } from "@/state/ready-now";
import type { BoardCard, BoardData } from "@/types";

vi.mock("@hello-pangea/dnd", () => ({
	Droppable: ({
		children,
	}: {
		children: (provided: {
			innerRef: (element: HTMLDivElement | null) => void;
			droppableProps: object;
			placeholder: null;
		}) => ReactNode;
	}): React.ReactElement => <>{children({ innerRef: () => {}, droppableProps: {}, placeholder: null })}</>,
}));

vi.mock("@/components/board-card", () => ({
	BoardCard: ({ card }: { card: BoardCard }): React.ReactElement => <div data-task-id={card.id}>{card.title}</div>,
}));

function createCard(id: string, title = id): BoardCard {
	return {
		id,
		title,
		prompt: title,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function createBoard({
	backlogCards,
	reviewCards = [],
	trashCards = [],
	dependencies = [],
}: {
	backlogCards: BoardCard[];
	reviewCards?: BoardCard[];
	trashCards?: BoardCard[];
	dependencies?: BoardData["dependencies"];
}): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: backlogCards },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: reviewCards },
			{ id: "trash", title: "Done", cards: trashCards },
		],
		dependencies,
	};
}

describe("BoardColumn ready now filter", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	async function renderBacklog(
		board: BoardData,
		readyNowFilter: boolean,
		overrides?: { onToggleReadyNowFilter?: () => void; editingTaskId?: string; inlineTaskEditor?: ReactNode },
	): Promise<void> {
		const backlog = board.columns[0];
		if (!backlog) {
			throw new Error("Expected a backlog column");
		}
		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardColumn
						column={backlog}
						taskSessions={{}}
						onCreateTask={() => {}}
						onStartAllTasks={() => {}}
						readyNowFilter={readyNowFilter}
						onToggleReadyNowFilter={overrides?.onToggleReadyNowFilter ?? (() => {})}
						isCardReadyNow={(taskId) => isTaskReadyNow(board, taskId)}
						editingTaskId={overrides?.editingTaskId ?? null}
						inlineTaskEditor={overrides?.inlineTaskEditor}
					/>
				</TooltipProvider>,
			);
		});
	}

	function findShowAllButton(): HTMLButtonElement | undefined {
		return Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Show all",
		);
	}

	it("shows every backlog card when the filter is off", async () => {
		const ready = createCard("ready", "Ready task");
		const blocked = createCard("blocked", "Blocked task");
		const board = createBoard({
			backlogCards: [ready, blocked],
			reviewCards: [createCard("prereq")],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "prereq", createdAt: 1 }],
		});

		await renderBacklog(board, false);

		expect(container.querySelector('[data-task-id="ready"]')).not.toBeNull();
		expect(container.querySelector('[data-task-id="blocked"]')).not.toBeNull();
		expect(container.textContent).not.toContain("No ready cards");
		expect(container.querySelector('[aria-label="Ready now"]')?.getAttribute("aria-pressed")).toBe("false");
	});

	it("shows a Panel indicator on the review column when panel review is enabled", async () => {
		const board = createBoard({
			backlogCards: [],
			reviewCards: [createCard("review-1")],
		});
		const review = board.columns.find((column) => column.id === "review");
		if (!review) {
			throw new Error("Expected a review column");
		}
		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardColumn column={review} taskSessions={{}} panelReviewEnabled />
				</TooltipProvider>,
			);
		});
		expect(container.textContent).toContain("Panel");
	});

	it("hides the Panel indicator when panel review is off", async () => {
		const board = createBoard({
			backlogCards: [],
			reviewCards: [createCard("review-1")],
		});
		const review = board.columns.find((column) => column.id === "review");
		if (!review) {
			throw new Error("Expected a review column");
		}
		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardColumn column={review} taskSessions={{}} panelReviewEnabled={false} />
				</TooltipProvider>,
			);
		});
		expect(container.textContent).not.toContain("Panel");
	});

	it("hides a card with one unfinished blocker when the filter is on", async () => {
		const ready = createCard("ready", "Ready task");
		const blocked = createCard("blocked", "Blocked task");
		const board = createBoard({
			backlogCards: [ready, blocked],
			reviewCards: [createCard("prereq")],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "prereq", createdAt: 1 }],
		});

		await renderBacklog(board, true);

		expect(container.querySelector('[data-task-id="ready"]')).not.toBeNull();
		expect(container.querySelector('[data-task-id="blocked"]')).toBeNull();
		expect(container.querySelector('[aria-label="Ready now"]')?.getAttribute("aria-pressed")).toBe("true");
	});

	it("shows a card whose blockers are all in trash", async () => {
		const ready = createCard("ready", "Ready task");
		const board = createBoard({
			backlogCards: [ready],
			trashCards: [createCard("prereq")],
			dependencies: [{ id: "dep-1", fromTaskId: "ready", toTaskId: "prereq", createdAt: 1 }],
		});

		await renderBacklog(board, true);

		expect(container.querySelector('[data-task-id="ready"]')).not.toBeNull();
		expect(container.textContent).not.toContain("No ready cards");
	});

	it("shows an empty state when no backlog cards are ready", async () => {
		const blocked = createCard("blocked", "Blocked task");
		const board = createBoard({
			backlogCards: [blocked],
			reviewCards: [createCard("prereq")],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "prereq", createdAt: 1 }],
		});

		await renderBacklog(board, true);

		expect(container.querySelector('[data-task-id="blocked"]')).toBeNull();
		expect(container.textContent).toContain("No ready cards");
	});

	it("keeps the real card total in the count badge while cards are hidden", async () => {
		const ready = createCard("ready", "Ready task");
		const blocked = createCard("blocked", "Blocked task");
		const board = createBoard({
			backlogCards: [ready, blocked],
			reviewCards: [createCard("prereq")],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "prereq", createdAt: 1 }],
		});

		await renderBacklog(board, false);
		expect(container.textContent).toContain("2");
		expect(container.textContent).not.toContain("blocked cards hidden");

		// A badge that only counts visible cards makes a hidden card indistinguishable from a
		// deleted one, which is what made dependency-linked cards look like they vanished.
		await renderBacklog(board, true);
		expect(container.textContent).toContain("1 / 2");
	});

	it("offers a way back to the hidden cards while some cards are still visible", async () => {
		const toggle = vi.fn();
		const ready = createCard("ready", "Ready task");
		const blocked = createCard("blocked", "Blocked task");
		const board = createBoard({
			backlogCards: [ready, blocked],
			reviewCards: [createCard("prereq")],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "prereq", createdAt: 1 }],
		});

		await renderBacklog(board, true, { onToggleReadyNowFilter: toggle });

		expect(container.textContent).toContain("1 blocked card hidden");
		const showAll = findShowAllButton();
		expect(showAll).not.toBeUndefined();
		await act(async () => {
			showAll?.click();
		});
		expect(toggle).toHaveBeenCalledTimes(1);
	});

	it("names the hidden cards and offers a way back when nothing is ready", async () => {
		const toggle = vi.fn();
		const blocked = createCard("blocked", "Blocked task");
		const alsoBlocked = createCard("also-blocked", "Also blocked task");
		const board = createBoard({
			backlogCards: [blocked, alsoBlocked],
			reviewCards: [createCard("prereq")],
			dependencies: [
				{ id: "dep-1", fromTaskId: "blocked", toTaskId: "prereq", createdAt: 1 },
				{ id: "dep-2", fromTaskId: "also-blocked", toTaskId: "prereq", createdAt: 2 },
			],
		});

		await renderBacklog(board, true, { onToggleReadyNowFilter: toggle });

		expect(container.textContent).toContain("2 blocked cards hidden");
		await act(async () => {
			findShowAllButton()?.click();
		});
		expect(toggle).toHaveBeenCalledTimes(1);
	});

	it("keeps the card being edited visible even when it is blocked", async () => {
		const blocked = createCard("blocked", "Blocked task");
		const board = createBoard({
			backlogCards: [blocked],
			reviewCards: [createCard("prereq")],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked", toTaskId: "prereq", createdAt: 1 }],
		});

		// The inline editor is rendered from the filtered list, so hiding the edited card would
		// make "edit task" a silent no-op.
		await renderBacklog(board, true, {
			editingTaskId: "blocked",
			inlineTaskEditor: <div data-testid="inline-editor" />,
		});

		expect(container.querySelector('[data-task-id="blocked"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="inline-editor"]')).not.toBeNull();
	});
});
