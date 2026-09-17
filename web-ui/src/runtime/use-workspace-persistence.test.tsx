import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { WorkspaceStateConflictError } from "@/runtime/workspace-state-query";
import type { BoardData } from "@/types";

function createBoardWithCard(taskId: string): BoardData {
	const board = createInitialBoardData();
	return {
		...board,
		columns: board.columns.map((column) =>
			column.id === "backlog"
				? {
						...column,
						cards: [
							{
								id: taskId,
								title: `Task ${taskId}`,
								prompt: `Do ${taskId}`,
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					}
				: column,
		),
	};
}

function Harness({
	board,
	workspaceRevision,
	hydrationNonce,
	persistWorkspaceState,
	refetchWorkspaceState,
	onWorkspaceRevisionChange,
}: {
	board: BoardData;
	workspaceRevision: number;
	hydrationNonce: number;
	persistWorkspaceState: (input: {
		workspaceId: string;
		payload: { board: BoardData; expectedRevision?: number };
	}) => Promise<{ revision: number }>;
	refetchWorkspaceState: () => Promise<unknown>;
	onWorkspaceRevisionChange: (revision: number) => void;
}): null {
	useWorkspacePersistence({
		board,
		sessions: {},
		currentProjectId: "marketply",
		workspaceRevision,
		hydrationNonce,
		canPersistWorkspaceState: true,
		isDocumentVisible: true,
		isWorkspaceStateRefreshing: false,
		persistWorkspaceState: persistWorkspaceState as never,
		refetchWorkspaceState,
		onWorkspaceRevisionChange,
	});
	return null;
}

describe("useWorkspacePersistence conflict recovery", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		vi.useFakeTimers();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
	});

	it("does not bump revision on conflict, so a stale board cannot overwrite CLI cards", async () => {
		const staleBoard = createBoardWithCard("only-ui-card");
		const persistWorkspaceState = vi.fn(async () => {
			throw new WorkspaceStateConflictError(42);
		});
		const refetchWorkspaceState = vi.fn(async () => undefined);
		const onWorkspaceRevisionChange = vi.fn();

		act(() => {
			root.render(
				<Harness
					board={staleBoard}
					workspaceRevision={10}
					hydrationNonce={1}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
				/>,
			);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		expect(persistWorkspaceState).toHaveBeenCalledTimes(1);
		const firstCall = persistWorkspaceState.mock.calls.at(0);
		expect(firstCall?.[0].payload.expectedRevision).toBe(10);
		expect(onWorkspaceRevisionChange).not.toHaveBeenCalled();
		expect(refetchWorkspaceState).toHaveBeenCalledTimes(1);

		act(() => {
			root.render(
				<Harness
					board={staleBoard}
					workspaceRevision={42}
					hydrationNonce={1}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
				/>,
			);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		expect(persistWorkspaceState).toHaveBeenCalledTimes(1);
	});
});
