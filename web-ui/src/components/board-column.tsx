import { Droppable } from "@hello-pangea/dnd";
import { Play, Plus, Trash2 } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { BoardCard } from "@/components/board-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ColumnIndicator } from "@/components/ui/column-indicator";
import { Tooltip } from "@/components/ui/tooltip";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { isCardDropDisabled, type ProgrammaticCardMoveInFlight } from "@/state/drag-rules";
import type { BoardCard as BoardCardModel, BoardColumnId, BoardColumn as BoardColumnModel } from "@/types";

const COLUMN_ACCENT_COLORS: Record<string, string> = {
	backlog: "var(--color-border-bright)",
	in_progress: "var(--color-status-blue)",
	review: "var(--color-status-purple)",
	trash: "var(--color-status-red)",
};

const COLUMN_EMPTY_LABELS: Record<string, string> = {
	backlog: "No backlog tasks",
	in_progress: "No tasks in progress",
	review: "No tasks awaiting review",
	trash: "No completed tasks",
};

export function BoardColumn({
	column,
	taskSessions,
	onCreateTask,
	onStartTask,
	onStartAllTasks,
	onClearTrash,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onSaveTitle,
	onCommitTask,
	onOpenPrTask,
	onCancelAutomaticTaskAction,
	onMoveToTrashTask,
	onRestoreFromTrashTask,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	moveToTrashLoadingById,
	onCardClick,
	activeDragTaskId,
	activeDragSourceColumnId,
	programmaticCardMoveInFlight,
	onDependencyPointerDown,
	onDependencyPointerEnter,
	dependencySourceTaskId,
	dependencyTargetTaskId,
	isDependencyLinking,
	workspacePath,
	defaultClineModelId,
	readyNowFilter,
	onToggleReadyNowFilter,
	isCardReadyNow,
}: {
	column: BoardColumnModel;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCardModel) => void;
	onSaveTitle?: (taskId: string, title: string) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	onRestoreFromTrashTask?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	onCardClick?: (card: BoardCardModel) => void;
	activeDragTaskId?: string | null;
	activeDragSourceColumnId?: BoardColumnId | null;
	programmaticCardMoveInFlight?: ProgrammaticCardMoveInFlight | null;
	onDependencyPointerDown?: (taskId: string, event: ReactMouseEvent<HTMLElement>) => void;
	onDependencyPointerEnter?: (taskId: string) => void;
	dependencySourceTaskId?: string | null;
	dependencyTargetTaskId?: string | null;
	isDependencyLinking?: boolean;
	workspacePath?: string | null;
	defaultClineModelId?: string | null;
	readyNowFilter?: boolean;
	onToggleReadyNowFilter?: () => void;
	isCardReadyNow?: (taskId: string) => boolean;
}): React.ReactElement {
	const canCreate = column.id === "backlog" && onCreateTask;
	const canStartAllTasks = column.id === "backlog" && onStartAllTasks;
	const canClearTrash = column.id === "trash" && onClearTrash;
	const canToggleReadyNow = column.id === "backlog" && Boolean(onToggleReadyNowFilter);
	const visibleCards =
		readyNowFilter && isCardReadyNow ? column.cards.filter((card) => isCardReadyNow(card.id)) : column.cards;
	const cardDropType = "CARD";
	const isDropDisabled =
		isCardDropDisabled(column.id, activeDragSourceColumnId ?? null, {
			activeDragTaskId,
			programmaticCardMoveInFlight,
		}) || Boolean(readyNowFilter && column.id === "backlog");
	const createTaskButtonText = (
		<span className="inline-flex items-center gap-1.5 font-medium">
			<span>Create task</span>
			<span aria-hidden className="text-text-tertiary">
				(c)
			</span>
		</span>
	);

	return (
		<section
			data-column-id={column.id}
			className="flex flex-col min-w-0 min-h-0 bg-surface-1 rounded-xl overflow-hidden border border-border shadow-xs"
			style={{
				flex: "1 1 0",
			}}
		>
			<div
				className="h-[2.5px] w-full shrink-0"
				style={{
					backgroundColor: COLUMN_ACCENT_COLORS[column.id] ?? "var(--color-border)",
					opacity: column.id === "backlog" ? 0.4 : 0.85,
				}}
			/>
			<div className="flex flex-col min-h-0 flex-1">
				<div
					className="flex items-center justify-between px-3 py-1.5 shrink-0 border-b border-border/60"
					style={{
						minHeight: 40,
					}}
				>
					<div className="flex items-center gap-2 min-w-0">
						<ColumnIndicator columnId={column.id} />
						<span className="font-semibold text-sm text-text-primary tracking-[-0.01em] truncate">
							{column.title}
						</span>
						<span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums bg-surface-3/80 text-text-secondary border border-border/60">
							{visibleCards.length}
						</span>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						{canToggleReadyNow ? (
							<Tooltip side="bottom" content="Show cards with no unfinished prerequisites">
								<Button
									variant={readyNowFilter ? "primary" : "ghost"}
									size="sm"
									aria-pressed={readyNowFilter}
									aria-label="Ready now"
									onClick={onToggleReadyNowFilter}
									className="h-7 px-2 text-text-secondary hover:text-text-primary"
								>
									Ready now
								</Button>
							</Tooltip>
						) : null}
						{canStartAllTasks ? (
							<Tooltip side="bottom" content="Start all backlog tasks">
								<Button
									icon={<Play size={13} />}
									variant="ghost"
									size="sm"
									onClick={onStartAllTasks}
									disabled={column.cards.length === 0}
									aria-label="Start all backlog tasks"
									className="h-7 w-7 text-text-secondary hover:text-text-primary"
								/>
							</Tooltip>
						) : null}
						{canClearTrash ? (
							<Tooltip side="bottom" content="Clear done items permanently">
								<Button
									icon={<Trash2 size={13} />}
									variant="ghost"
									size="sm"
									className="h-7 w-7 text-text-secondary hover:text-status-red"
									onClick={onClearTrash}
									disabled={column.cards.length === 0}
									aria-label="Clear done"
								/>
							</Tooltip>
						) : null}
					</div>
				</div>

				<Droppable droppableId={column.id} type={cardDropType} isDropDisabled={isDropDisabled}>
					{(cardProvided, snapshot) => (
						<div
							ref={cardProvided.innerRef}
							{...cardProvided.droppableProps}
							className={cn(
								"kb-column-cards transition-colors duration-fast ease",
								snapshot?.isDraggingOver && "bg-surface-2/40",
							)}
						>
							{canCreate ? (
								<Button
									icon={<Plus size={14} />}
									aria-label="Create task"
									fill
									variant="default"
									onClick={onCreateTask}
									className="h-8 mb-2 shrink-0 border border-dashed border-border-bright/70 bg-surface-2/50 hover:bg-surface-3 hover:border-solid hover:border-accent/60 text-text-secondary hover:text-text-primary text-xs font-medium rounded-lg"
								>
									{createTaskButtonText}
								</Button>
							) : null}

							{readyNowFilter && visibleCards.length === 0 ? (
								<div className="kb-column-empty flex flex-1 flex-col items-center justify-center p-4 text-center rounded-lg border border-dashed border-border/60 text-text-tertiary my-2">
									<p className="text-xs text-text-tertiary m-0">No ready cards</p>
								</div>
							) : null}
							{!readyNowFilter && column.cards.length === 0 && !canCreate ? (
								<div className="kb-column-empty flex flex-1 flex-col items-center justify-center p-4 text-center rounded-lg border border-dashed border-border/60 text-text-tertiary my-2">
									<p className="text-xs text-text-tertiary m-0">
										{COLUMN_EMPTY_LABELS[column.id] ?? "No tasks"}
									</p>
								</div>
							) : null}

							{(() => {
								const items: ReactNode[] = [];
								let draggableIndex = 0;
								for (const card of visibleCards) {
									if (column.id === "backlog" && editingTaskId === card.id) {
										items.push(
											<div
												key={card.id}
												data-task-id={card.id}
												data-column-id={column.id}
												style={{ marginBottom: 6 }}
											>
												{inlineTaskEditor}
											</div>,
										);
										continue;
									}
									items.push(
										<BoardCard
											key={card.id}
											card={card}
											index={draggableIndex}
											columnId={column.id}
											sessionSummary={taskSessions[card.id]}
											onStart={onStartTask}
											onMoveToTrash={onMoveToTrashTask}
											onRestoreFromTrash={onRestoreFromTrashTask}
											onCommit={onCommitTask}
											onOpenPr={onOpenPrTask}
											onCancelAutomaticAction={onCancelAutomaticTaskAction}
											isCommitLoading={commitTaskLoadingById?.[card.id] ?? false}
											isOpenPrLoading={openPrTaskLoadingById?.[card.id] ?? false}
											isMoveToTrashLoading={moveToTrashLoadingById?.[card.id] ?? false}
											onDependencyPointerDown={onDependencyPointerDown}
											onDependencyPointerEnter={onDependencyPointerEnter}
											isDependencySource={dependencySourceTaskId === card.id}
											isDependencyTarget={dependencyTargetTaskId === card.id}
											isDependencyLinking={isDependencyLinking}
											workspacePath={workspacePath}
											defaultClineModelId={defaultClineModelId}
											onSaveTitle={onSaveTitle}
											onClick={() => {
												if (column.id === "backlog") {
													onEditTask?.(card);
													return;
												}
												onCardClick?.(card);
											}}
										/>,
									);
									draggableIndex += 1;
								}
								return items;
							})()}
							{cardProvided.placeholder}
						</div>
					)}
				</Droppable>
			</div>
		</section>
	);
}
