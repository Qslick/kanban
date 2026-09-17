import { getTaskColumnId } from "@/state/board-state";
import type { BoardCard, BoardData } from "@/types";

export function isTaskReadyNow(board: BoardData, taskId: string): boolean {
	const prerequisites = board.dependencies.filter((dependency) => dependency.fromTaskId === taskId);
	return prerequisites.every((dependency) => getTaskColumnId(board, dependency.toTaskId) === "trash");
}

export function getReadyNowBacklogCards(board: BoardData): BoardCard[] {
	const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards ?? [];
	return backlogCards.filter((card) => isTaskReadyNow(board, card.id));
}

export function remapBacklogDragSourceIndex(board: BoardData, draggableId: string, sourceIndex: number): number {
	const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards;
	const actualIndex = backlogCards?.findIndex((card) => card.id === draggableId);
	if (actualIndex === undefined || actualIndex < 0) {
		return sourceIndex;
	}
	return actualIndex;
}
