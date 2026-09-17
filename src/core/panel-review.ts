import { z } from "zod";

export const PANEL_REVIEW_FAMILIES = ["grok", "claude", "gpt", "gemini"] as const;
export type PanelReviewFamily = (typeof PANEL_REVIEW_FAMILIES)[number];

export const PANEL_REVIEW_MODES = ["inherit", "off", "custom"] as const;
export type PanelReviewMode = (typeof PANEL_REVIEW_MODES)[number];

export const PANEL_REVIEW_RUN_STATUSES = ["pending", "passed", "rejected", "split", "skipped"] as const;
export type PanelReviewRunStatus = (typeof PANEL_REVIEW_RUN_STATUSES)[number];

export const PANEL_REVIEW_VERDICT_KINDS = [
	"APPROVE",
	"APPROVE_WITH_CHANGES",
	"REJECT",
	"NEED_INFO",
	"UNAVAILABLE",
	"BENCHED",
] as const;
export type PanelReviewVerdictKind = (typeof PANEL_REVIEW_VERDICT_KINDS)[number];

export const DEFAULT_PANEL_REVIEW_ENABLED = false;
export const DEFAULT_PANEL_REVIEW_FAMILIES: PanelReviewFamily[] = [...PANEL_REVIEW_FAMILIES];
export const DEFAULT_PANEL_REVIEW_MODE: PanelReviewMode = "inherit";

export const panelReviewFamilySchema = z.enum(PANEL_REVIEW_FAMILIES);
export const panelReviewModeSchema = z.enum(PANEL_REVIEW_MODES);
export const panelReviewRunStatusSchema = z.enum(PANEL_REVIEW_RUN_STATUSES);
export const panelReviewVerdictKindSchema = z.enum(PANEL_REVIEW_VERDICT_KINDS);

export const panelReviewVerdictSchema = z.object({
	family: panelReviewFamilySchema,
	verdict: panelReviewVerdictKindSchema,
	note: z.string().optional(),
});
export type PanelReviewVerdict = z.infer<typeof panelReviewVerdictSchema>;

export const panelReviewRunSchema = z.object({
	status: panelReviewRunStatusSchema,
	verdicts: z.array(panelReviewVerdictSchema),
	recordedAt: z.number(),
	reportPath: z.string().optional(),
	headCommit: z.string().nullable().optional(),
	note: z.string().optional(),
});
export type PanelReviewRun = z.infer<typeof panelReviewRunSchema>;

export interface PanelReviewConfig {
	panelReviewEnabled: boolean;
	panelReviewFamilies: PanelReviewFamily[];
}

export const DEFAULT_PANEL_REVIEW_CONFIG: PanelReviewConfig = {
	panelReviewEnabled: DEFAULT_PANEL_REVIEW_ENABLED,
	panelReviewFamilies: [...DEFAULT_PANEL_REVIEW_FAMILIES],
};

export type PanelReviewSkipReason = "disabled" | "card-off" | "inherit-empty";

export interface EffectivePanelReview {
	mode: PanelReviewMode;
	families: PanelReviewFamily[];
	skipReason: PanelReviewSkipReason | null;
}

const PANEL_REVIEW_FAMILY_SET = new Set<string>(PANEL_REVIEW_FAMILIES);
const APPROVING_VERDICTS = new Set<PanelReviewVerdictKind>(["APPROVE", "APPROVE_WITH_CHANGES"]);
const DROPPED_VERDICTS = new Set<PanelReviewVerdictKind>(["UNAVAILABLE", "BENCHED"]);

export function isPanelReviewFamily(value: string): value is PanelReviewFamily {
	return PANEL_REVIEW_FAMILY_SET.has(value);
}

export function parsePanelReviewFamilies(value: unknown): PanelReviewFamily[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const families: PanelReviewFamily[] = [];
	const seen = new Set<PanelReviewFamily>();
	for (const item of value) {
		if (typeof item !== "string" || !isPanelReviewFamily(item) || seen.has(item)) {
			continue;
		}
		seen.add(item);
		families.push(item);
	}
	return families;
}

export function normalizePanelReviewFamilies(value: unknown): PanelReviewFamily[] {
	return parsePanelReviewFamilies(value) ?? [...DEFAULT_PANEL_REVIEW_FAMILIES];
}

export function clonePanelReviewFamilies(families: readonly PanelReviewFamily[]): PanelReviewFamily[] {
	return [...families];
}

export function arePanelReviewFamiliesEqual(
	left: readonly PanelReviewFamily[],
	right: readonly PanelReviewFamily[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((family, index) => family === right[index]);
}

export function resolvePanelReviewMode(value: PanelReviewMode | null | undefined): PanelReviewMode {
	if (value === "off" || value === "custom") {
		return value;
	}
	return DEFAULT_PANEL_REVIEW_MODE;
}

export function implementerFamilyForAgent(agentId: string | null | undefined): PanelReviewFamily | null {
	if (agentId === "grok") {
		return "grok";
	}
	if (agentId === "claude" || agentId === "cline") {
		return "claude";
	}
	if (agentId === "codex") {
		return "gpt";
	}
	if (agentId === "gemini") {
		return "gemini";
	}
	return null;
}

export function resolveEffectivePanelReview(input: {
	config: PanelReviewConfig;
	cardMode?: PanelReviewMode | null;
	cardFamilies?: readonly PanelReviewFamily[] | null;
	implementerAgentId?: string | null;
}): EffectivePanelReview {
	const mode = resolvePanelReviewMode(input.cardMode);
	if (!input.config.panelReviewEnabled) {
		return { mode, families: [], skipReason: "disabled" };
	}
	if (mode === "off") {
		return { mode, families: [], skipReason: "card-off" };
	}

	if (mode === "custom") {
		const families = parsePanelReviewFamilies(input.cardFamilies ?? []) ?? [];
		return { mode, families, skipReason: null };
	}

	const inherited = normalizePanelReviewFamilies(input.config.panelReviewFamilies);
	const implementerFamily = implementerFamilyForAgent(input.implementerAgentId);
	const families = implementerFamily ? inherited.filter((family) => family !== implementerFamily) : inherited;
	if (families.length === 0) {
		return { mode, families: [], skipReason: "inherit-empty" };
	}
	return { mode, families, skipReason: null };
}

function isAvailableVerdict(verdict: PanelReviewVerdict): boolean {
	return !DROPPED_VERDICTS.has(verdict.verdict);
}

export function summarizePanelReviewRun(input: {
	verdicts: PanelReviewVerdict[];
	recordedAt: number;
	headCommit: string | null;
	selection: "inherit" | "custom";
	reportPath?: string;
}): PanelReviewRun {
	const available = input.verdicts.filter(isAvailableVerdict);
	if (available.length === 0) {
		if (input.selection === "custom") {
			return {
				status: "rejected",
				verdicts: input.verdicts,
				recordedAt: input.recordedAt,
				headCommit: input.headCommit,
				note: "All selected panel seats were unavailable.",
				...(input.reportPath ? { reportPath: input.reportPath } : {}),
			};
		}
		return {
			status: "skipped",
			verdicts: input.verdicts,
			recordedAt: input.recordedAt,
			headCommit: input.headCommit,
			note: "No panel seats remained after dropping unavailable reviewers.",
			...(input.reportPath ? { reportPath: input.reportPath } : {}),
		};
	}

	const hasApprove = available.some((verdict) => APPROVING_VERDICTS.has(verdict.verdict));
	const hasReject = available.some((verdict) => verdict.verdict === "REJECT");
	const hasNeedInfo = available.some((verdict) => verdict.verdict === "NEED_INFO");

	let status: PanelReviewRunStatus;
	let note: string | undefined;
	if (hasReject && hasApprove) {
		status = "split";
	} else if (hasReject) {
		status = "rejected";
	} else if (hasApprove && !hasNeedInfo) {
		status = "passed";
	} else if (hasApprove && hasNeedInfo) {
		status = "split";
		note = "Approving seats conflicted with NEED_INFO.";
	} else {
		status = "rejected";
		note = "Panel seats did not approve the worktree.";
	}

	return {
		status,
		verdicts: input.verdicts,
		recordedAt: input.recordedAt,
		headCommit: input.headCommit,
		...(note ? { note } : {}),
		...(input.reportPath ? { reportPath: input.reportPath } : {}),
	};
}

export function createPendingPanelReviewRun(input: { recordedAt: number; headCommit: string | null }): PanelReviewRun {
	return {
		status: "pending",
		verdicts: [],
		recordedAt: input.recordedAt,
		headCommit: input.headCommit,
	};
}

export function createSkippedPanelReviewRun(input: {
	recordedAt: number;
	headCommit: string | null;
	note?: string;
}): PanelReviewRun {
	return {
		status: "skipped",
		verdicts: [],
		recordedAt: input.recordedAt,
		headCommit: input.headCommit,
		...(input.note ? { note: input.note } : {}),
	};
}

export function isPanelReviewRunStale(run: PanelReviewRun | null | undefined, headCommit: string | null): boolean {
	if (!run) {
		return true;
	}
	if (run.status === "pending") {
		return true;
	}
	if (run.headCommit === undefined) {
		return true;
	}
	return run.headCommit !== headCommit;
}

export function panelReviewAllowsAutoReview(input: {
	skipReason: PanelReviewSkipReason | null;
	run: PanelReviewRun | null | undefined;
}): boolean {
	if (input.skipReason !== null) {
		return true;
	}
	if (!input.run) {
		return false;
	}
	return input.run.status === "passed" || input.run.status === "skipped";
}
