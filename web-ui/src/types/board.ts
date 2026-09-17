import { isPendingGitActionStale, PENDING_GIT_ACTION_STALE_AFTER_MS } from "@runtime-task-state";
import type {
	PanelReviewRunStatus,
	PanelReviewVerdict,
	PanelReviewVerdictKind,
	RuntimeAgentId,
	RuntimeBoardColumnId,
	RuntimePanelReviewFamily,
	RuntimePanelReviewMode,
	RuntimePanelReviewRun,
	RuntimeTaskAgentSettings,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskImage,
	RuntimeTaskPendingGitAction,
	RuntimeTaskVerifyResult,
} from "@/runtime/types";

export { isPendingGitActionStale, PENDING_GIT_ACTION_STALE_AFTER_MS };
export type BoardColumnId = RuntimeBoardColumnId;

export type TaskAutoReviewMode = RuntimeTaskAutoReviewMode;
export type TaskImage = RuntimeTaskImage;

export const DEFAULT_TASK_AUTO_REVIEW_MODE: TaskAutoReviewMode = "commit";

export function resolveTaskAutoReviewMode(mode: TaskAutoReviewMode | null | undefined): TaskAutoReviewMode {
	if (mode === "pr") {
		return mode;
	}
	return DEFAULT_TASK_AUTO_REVIEW_MODE;
}

export function getTaskAutoReviewActionLabel(mode: TaskAutoReviewMode | null | undefined): string {
	const resolvedMode = resolveTaskAutoReviewMode(mode);
	if (resolvedMode === "pr") {
		return "PR";
	}
	return "commit";
}

export function getTaskAutoReviewCancelButtonLabel(mode: TaskAutoReviewMode | null | undefined): string {
	const resolvedMode = resolveTaskAutoReviewMode(mode);
	if (resolvedMode === "pr") {
		return "Cancel Auto-PR";
	}
	return "Cancel Auto-commit";
}

export type TaskPendingGitAction = RuntimeTaskPendingGitAction;
export type TaskVerifyResult = RuntimeTaskVerifyResult;

export type TaskVerifyStatusKind = "passed" | "failed" | "pending";

export function getTaskVerifyStatus(
	card: Pick<BoardCard, "verifyCommand" | "verifyResult">,
): { kind: TaskVerifyStatusKind; label: string } | null {
	const command = card.verifyCommand?.trim();
	if (!command) {
		return null;
	}
	if (card.verifyResult?.ok === true) {
		return { kind: "passed", label: "Verify passed" };
	}
	if (card.verifyResult?.ok === false) {
		return { kind: "failed", label: "Verify failed" };
	}
	return { kind: "pending", label: "Verify pending" };
}

export type PanelReviewFamily = RuntimePanelReviewFamily;
export type PanelReviewMode = RuntimePanelReviewMode;
export type PanelReviewRun = RuntimePanelReviewRun;
export type { PanelReviewRunStatus, PanelReviewVerdict, PanelReviewVerdictKind };

export interface BoardCard {
	id: string;
	title: string;
	prompt: string;
	startInPlanMode: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: TaskAutoReviewMode;
	images?: TaskImage[];
	agentId?: RuntimeAgentId;
	agentSettings?: RuntimeTaskAgentSettings;
	panelReviewMode?: PanelReviewMode;
	panelReviewFamilies?: PanelReviewFamily[];
	panelReviewRun?: PanelReviewRun;
	baseRef: string;
	createdAt: number;
	updatedAt: number;
	pendingGitAction?: TaskPendingGitAction | null;
	verifyCommand?: string;
	verifyResult?: TaskVerifyResult;
}

export interface BoardColumn {
	id: BoardColumnId;
	title: string;
	cards: BoardCard[];
}

export interface BoardDependency {
	id: string;
	fromTaskId: string;
	toTaskId: string;
	createdAt: number;
}

export interface BoardData {
	columns: BoardColumn[];
	dependencies: BoardDependency[];
}

const PANEL_REVIEW_MODES = new Set<PanelReviewMode>(["inherit", "off", "custom"]);
const PANEL_REVIEW_FAMILIES = new Set<PanelReviewFamily>(["grok", "claude", "gpt", "gemini"]);
const PANEL_REVIEW_RUN_STATUSES = new Set<PanelReviewRunStatus>(["pending", "passed", "rejected", "split", "skipped"]);
const PANEL_REVIEW_VERDICT_KINDS = new Set<PanelReviewVerdictKind>([
	"APPROVE",
	"APPROVE_WITH_CHANGES",
	"REJECT",
	"NEED_INFO",
	"UNAVAILABLE",
	"BENCHED",
]);

export function normalizePanelReviewMode(value: unknown): PanelReviewMode | undefined {
	if (typeof value === "string" && PANEL_REVIEW_MODES.has(value as PanelReviewMode)) {
		return value as PanelReviewMode;
	}
	return undefined;
}

export function normalizePanelReviewFamilies(value: unknown): PanelReviewFamily[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const families: PanelReviewFamily[] = [];
	const seen = new Set<PanelReviewFamily>();
	for (const item of value) {
		if (typeof item !== "string" || !PANEL_REVIEW_FAMILIES.has(item as PanelReviewFamily)) {
			continue;
		}
		const family = item as PanelReviewFamily;
		if (seen.has(family)) {
			continue;
		}
		seen.add(family);
		families.push(family);
	}
	return families;
}

function normalizePanelReviewVerdict(value: unknown): PanelReviewVerdict | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const candidate = value as { family?: unknown; verdict?: unknown; note?: unknown };
	if (typeof candidate.family !== "string" || !PANEL_REVIEW_FAMILIES.has(candidate.family as PanelReviewFamily)) {
		return null;
	}
	if (
		typeof candidate.verdict !== "string" ||
		!PANEL_REVIEW_VERDICT_KINDS.has(candidate.verdict as PanelReviewVerdictKind)
	) {
		return null;
	}
	return {
		family: candidate.family as PanelReviewFamily,
		verdict: candidate.verdict as PanelReviewVerdictKind,
		...(typeof candidate.note === "string" ? { note: candidate.note } : {}),
	};
}

export function normalizePanelReviewRun(value: unknown): PanelReviewRun | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const candidate = value as {
		status?: unknown;
		verdicts?: unknown;
		recordedAt?: unknown;
		reportPath?: unknown;
		headCommit?: unknown;
		note?: unknown;
	};
	if (
		typeof candidate.status !== "string" ||
		!PANEL_REVIEW_RUN_STATUSES.has(candidate.status as PanelReviewRunStatus)
	) {
		return undefined;
	}
	if (typeof candidate.recordedAt !== "number" || !Array.isArray(candidate.verdicts)) {
		return undefined;
	}
	const verdicts: PanelReviewVerdict[] = [];
	for (const item of candidate.verdicts) {
		const verdict = normalizePanelReviewVerdict(item);
		if (verdict) {
			verdicts.push(verdict);
		}
	}
	return {
		status: candidate.status as PanelReviewRunStatus,
		verdicts,
		recordedAt: candidate.recordedAt,
		...(typeof candidate.reportPath === "string" ? { reportPath: candidate.reportPath } : {}),
		...(candidate.headCommit === null || typeof candidate.headCommit === "string"
			? { headCommit: candidate.headCommit }
			: {}),
		...(typeof candidate.note === "string" ? { note: candidate.note } : {}),
	};
}

export interface ReviewTaskWorkspaceSnapshot {
	taskId: string;
	path: string;
	branch: string | null;
	isDetached: boolean;
	headCommit: string | null;
	changedFiles: number | null;
	additions: number | null;
	deletions: number | null;
}

export interface CardSelection {
	card: BoardCard;
	column: BoardColumn;
	allColumns: BoardColumn[];
}
