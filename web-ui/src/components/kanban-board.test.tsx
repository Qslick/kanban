import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanBoard, type RequestProgrammaticCardMove } from "@/components/kanban-board";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { BoardCard, BoardData } from "@/types";

const dndMock = vi.hoisted(() => ({
	sensorApi: null as {
		tryGetLock: ReturnType<typeof vi.fn>;
	} | null,
}));

vi.mock("@hello-pangea/dnd", async () => {
	const React = await vi.importActual<typeof import("react")>("react");

	return {
		DragDropContext: ({
			children,
			sensors,
		}: {
			children: ReactNode;
			sensors?: Array<(api: NonNullable<typeof dndMock.sensorApi>) => void>;
		}): React.ReactElement => {
			React.useEffect(() => {
				if (!dndMock.sensorApi) {
					return;
				}
				for (const sensor of sensors ?? []) {
					sensor(dndMock.sensorApi);
				}
			}, [sensors]);

			return <>{children}</>;
		},
	};
});

vi.mock("@/components/board-column", () => ({
	BoardColumn: ({
		column,
		readyNowFilter,
		onToggleReadyNowFilter,
		isCardReadyNow,
	}: {
		column: BoardData["columns"][number];
		readyNowFilter?: boolean;
		onToggleReadyNowFilter?: () => void;
		isCardReadyNow?: (taskId: string) => boolean;
	}): React.ReactElement => {
		const visibleCards =
			readyNowFilter && isCardReadyNow ? column.cards.filter((card) => isCardReadyNow(card.id)) : column.cards;
		return (
			<section data-column-id={column.id}>
				{onToggleReadyNowFilter ? (
					<button
						type="button"
						aria-label="Ready now"
						aria-pressed={readyNowFilter ? "true" : "false"}
						onClick={onToggleReadyNowFilter}
					>
						Ready now
					</button>
				) : null}
				{readyNowFilter && visibleCards.length === 0 ? <p>No ready cards</p> : null}
				<div className="kb-column-cards">
					{visibleCards.map((card) => (
						<div key={card.id} data-task-id={card.id} />
					))}
				</div>
			</section>
		);
	},
}));

vi.mock("@/components/dependencies/dependency-overlay", () => ({
	DependencyOverlay: (): null => null,
}));

vi.mock("@/components/dependencies/use-dependency-linking", () => ({
	useDependencyLinking: () => ({
		draft: null,
		onDependencyPointerDown: vi.fn(),
		onDependencyPointerEnter: vi.fn(),
	}),
}));

function createRect(left: number, top: number, width: number, height: number): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

describe("KanbanBoard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		window.localStorage.clear();
		vi.useFakeTimers();
		vi.spyOn(performance, "now").mockImplementation(() => Date.now());
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
			return window.setTimeout(() => {
				callback(performance.now());
			}, 16);
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number) => {
			window.clearTimeout(handle);
		});
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
			this: HTMLElement,
		) {
			if (this.dataset.taskId === "source-task") {
				return createRect(20, 20, 160, 96);
			}
			if (this.dataset.taskId === "target-task-1") {
				return createRect(300, 20, 160, 96);
			}
			if (this.classList.contains("kb-column-cards")) {
				const columnId = this.closest<HTMLElement>("[data-column-id]")?.dataset.columnId;
				if (columnId === "backlog") {
					return createRect(12, 12, 176, 420);
				}
				if (columnId === "in_progress") {
					return createRect(292, 12, 176, 420);
				}
			}
			return createRect(0, 0, 0, 0);
		});
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
		dndMock.sensorApi = null;
		vi.restoreAllMocks();
		vi.useRealTimers();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("marks the board while a programmatic move is active", async () => {
		const dragActions = {
			isActive: vi.fn(() => true),
			move: vi.fn(),
			drop: vi.fn(),
			cancel: vi.fn(),
		};
		const preDrag = {
			fluidLift: vi.fn(() => dragActions),
			isActive: vi.fn(() => true),
			abort: vi.fn(),
		};
		dndMock.sensorApi = {
			tryGetLock: vi.fn(() => preDrag),
		};

		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "source-task",
							title: "Source task",
							prompt: "Source task",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: "target-task-1",
							title: "Target task 1",
							prompt: "Target task 1",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		let requestMove: RequestProgrammaticCardMove | null = null;

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
					onRequestProgrammaticCardMoveReady={(nextRequestMove) => {
						requestMove = nextRequestMove;
					}}
				/>,
			);
		});

		const boardElement = container.querySelector<HTMLElement>(".kb-board");
		expect(boardElement?.dataset.programmaticCardMove).toBeUndefined();

		await act(async () => {
			requestMove?.({
				taskId: "source-task",
				fromColumnId: "backlog",
				toColumnId: "in_progress",
				insertAtTop: true,
			});
		});

		expect(boardElement?.dataset.programmaticCardMove).toBe("true");
	});

	it("persists the ready now filter and hides blocked backlog cards", async () => {
		function createCard(id: string): BoardCard {
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

		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [createCard("ready-task"), createCard("blocked-task")],
				},
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [createCard("prereq-task")] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [{ id: "dep-1", fromTaskId: "blocked-task", toTaskId: "prereq-task", createdAt: 1 }],
		};

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={board.dependencies}
					onDragEnd={() => {}}
				/>,
			);
		});

		expect(container.querySelector('[data-task-id="ready-task"]')).not.toBeNull();
		expect(container.querySelector('[data-task-id="blocked-task"]')).not.toBeNull();

		const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Ready now"]');
		expect(toggle?.getAttribute("aria-pressed")).toBe("false");

		await act(async () => {
			toggle?.click();
		});

		expect(toggle?.getAttribute("aria-pressed")).toBe("true");
		expect(window.localStorage.getItem(LocalStorageKey.ReadyNowFilter)).toBe("true");
		expect(container.querySelector('[data-task-id="ready-task"]')).not.toBeNull();
		expect(container.querySelector('[data-task-id="blocked-task"]')).toBeNull();
	});
});
