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

/** @deprecated Use PANEL_REVIEW_VERDICT_KINDS. Kept for settings-era imports. */
export const PANEL_REVIEW_VERDICTS = PANEL_REVIEW_VERDICT_KINDS;
export type PanelReviewVerdictKindAlias = PanelReviewVerdictKind;

export const DEFAULT_PANEL_REVIEW_ENABLED = false;
export const DEFAULT_PANEL_REVIEW_MODE: PanelReviewMode = "inherit";
export const DEFAULT_PANEL_REVIEW_FAMILIES: PanelReviewFamily[] = [...PANEL_REVIEW_FAMILIES];

export const PANEL_REVIEW_FAMILY_LABELS: Record<PanelReviewFamily, string> = {
	grok: "Grok",
	claude: "Claude",
	gpt: "GPT",
	gemini: "Gemini",
};

export const PANEL_REVIEW_MODE_LABELS: Record<PanelReviewMode, string> = {
	inherit: "Inherit",
	off: "Off",
	custom: "Custom",
};

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
	families: z.array(panelReviewFamilySchema).optional(),
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

export interface PanelReviewCardInput {
	panelReviewMode?: PanelReviewMode | null;
	panelReviewFamilies?: readonly PanelReviewFamily[] | null;
}

export interface PanelReviewConfigInput {
	panelReviewEnabled: boolean;
	panelReviewFamilies?: readonly PanelReviewFamily[] | null;
}

export interface EffectivePanelReview {
	mode: PanelReviewMode;
	families: PanelReviewFamily[];
	skipReason: PanelReviewSkipReason | null;
	/** True when a panel was requested. Families may still be empty after exclusion. */
	enabled: boolean;
}

const PANEL_REVIEW_FAMILY_SET = new Set<string>(PANEL_REVIEW_FAMILIES);
const PANEL_REVIEW_MODE_SET = new Set<string>(PANEL_REVIEW_MODES);
const APPROVING_VERDICTS = new Set<PanelReviewVerdictKind>(["APPROVE", "APPROVE_WITH_CHANGES"]);
const DROPPED_VERDICTS = new Set<PanelReviewVerdictKind>(["UNAVAILABLE", "BENCHED"]);

export function isPanelReviewFamily(value: unknown): value is PanelReviewFamily {
	return typeof value === "string" && PANEL_REVIEW_FAMILY_SET.has(value);
}

export function isPanelReviewMode(value: unknown): value is PanelReviewMode {
	return typeof value === "string" && PANEL_REVIEW_MODE_SET.has(value);
}

export function resolveTaskPanelReviewMode(mode: PanelReviewMode | null | undefined): PanelReviewMode {
	if (mode === "off" || mode === "custom") {
		return mode;
	}
	return DEFAULT_PANEL_REVIEW_MODE;
}

export function resolvePanelReviewMode(value: PanelReviewMode | null | undefined): PanelReviewMode {
	return resolveTaskPanelReviewMode(value);
}

export function sanitizePanelReviewFamilies(families: readonly unknown[]): PanelReviewFamily[] {
	const present = new Set<PanelReviewFamily>();
	for (const family of families) {
		if (isPanelReviewFamily(family)) {
			present.add(family);
		}
	}
	return PANEL_REVIEW_FAMILIES.filter((family) => present.has(family));
}

export function parsePanelReviewFamilies(value: unknown): PanelReviewFamily[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	return sanitizePanelReviewFamilies(value);
}

export function normalizePanelReviewFamilies(value: unknown): PanelReviewFamily[] {
	const parsed = parsePanelReviewFamilies(value);
	if (!parsed || parsed.length === 0) {
		return [...DEFAULT_PANEL_REVIEW_FAMILIES];
	}
	return parsed;
}

export function resolveConfigPanelReviewFamilies(value: unknown): PanelReviewFamily[] {
	return normalizePanelReviewFamilies(value);
}

export function clonePanelReviewFamilies(
	families: readonly PanelReviewFamily[] | null | undefined,
): PanelReviewFamily[] {
	if (!families) {
		return [];
	}
	return [...families];
}

export function arePanelReviewFamiliesEqual(
	left: readonly PanelReviewFamily[] | null | undefined,
	right: readonly PanelReviewFamily[] | null | undefined,
): boolean {
	const normalizedLeft = sanitizePanelReviewFamilies(left ?? []);
	const normalizedRight = sanitizePanelReviewFamilies(right ?? []);
	if (normalizedLeft.length !== normalizedRight.length) {
		return false;
	}
	return normalizedLeft.every((family, index) => family === normalizedRight[index]);
}

export function parsePanelReviewMode(value: string): PanelReviewMode {
	const normalized = value.trim().toLowerCase();
	if (isPanelReviewMode(normalized)) {
		return normalized;
	}
	throw new Error(`Invalid panel review mode "${value}". Expected: inherit, off, custom.`);
}

export function parsePanelReviewFamiliesInput(value: string): PanelReviewFamily[] {
	const parts = value
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter((part) => part.length > 0);
	if (parts.length === 0) {
		throw new Error("Invalid --panel-review-families value. Expected one or more of: grok, claude, gpt, gemini.");
	}
	const invalid = parts.find((part) => !isPanelReviewFamily(part));
	if (invalid) {
		throw new Error(`Invalid panel review family "${invalid}". Expected: grok, claude, gpt, gemini.`);
	}
	return sanitizePanelReviewFamilies(parts);
}

export function panelReviewFamilyForAgentId(agentId: string | null | undefined): PanelReviewFamily | null {
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

export function implementerFamilyForAgent(agentId: string | null | undefined): PanelReviewFamily | null {
	return panelReviewFamilyForAgentId(agentId);
}

export function excludeImplementerFamily(
	families: readonly PanelReviewFamily[],
	implementerAgentId: string | null | undefined,
): PanelReviewFamily[] {
	const implementerFamily = panelReviewFamilyForAgentId(implementerAgentId);
	if (!implementerFamily) {
		return sanitizePanelReviewFamilies(families);
	}
	return sanitizePanelReviewFamilies(families).filter((family) => family !== implementerFamily);
}

function toEffective(input: {
	mode: PanelReviewMode;
	families: PanelReviewFamily[];
	skipReason: PanelReviewSkipReason | null;
}): EffectivePanelReview {
	return {
		...input,
		enabled: input.skipReason === null || input.skipReason === "inherit-empty",
	};
}

function resolveFromParts(input: {
	configEnabled: boolean;
	configFamilies: readonly PanelReviewFamily[] | null | undefined;
	cardMode?: PanelReviewMode | null;
	cardFamilies?: readonly PanelReviewFamily[] | null;
	implementerAgentId?: string | null;
}): EffectivePanelReview {
	const mode = resolveTaskPanelReviewMode(input.cardMode);
	if (mode === "off") {
		return toEffective({ mode, families: [], skipReason: "card-off" });
	}
	if (mode === "custom") {
		return toEffective({
			mode,
			families: sanitizePanelReviewFamilies(input.cardFamilies ?? []),
			skipReason: null,
		});
	}
	if (!input.configEnabled) {
		return toEffective({ mode, families: [], skipReason: "disabled" });
	}
	const inherited = normalizePanelReviewFamilies(input.configFamilies);
	const families = excludeImplementerFamily(inherited, input.implementerAgentId);
	if (families.length === 0) {
		return toEffective({ mode, families: [], skipReason: "inherit-empty" });
	}
	return toEffective({ mode, families, skipReason: null });
}

export function resolveEffectivePanelReview(
	input:
		| {
				card: PanelReviewCardInput;
				config: PanelReviewConfigInput;
				implementerAgentId?: string | null;
		  }
		| {
				config: PanelReviewConfig | PanelReviewConfigInput;
				cardMode?: PanelReviewMode | null;
				cardFamilies?: readonly PanelReviewFamily[] | null;
				implementerAgentId?: string | null;
				card?: undefined;
		  },
): EffectivePanelReview {
	if ("card" in input && input.card !== undefined) {
		return resolveFromParts({
			configEnabled: input.config.panelReviewEnabled,
			configFamilies: input.config.panelReviewFamilies,
			cardMode: input.card.panelReviewMode,
			cardFamilies: input.card.panelReviewFamilies,
			implementerAgentId: input.implementerAgentId,
		});
	}
	return resolveFromParts({
		configEnabled: input.config.panelReviewEnabled,
		configFamilies: input.config.panelReviewFamilies,
		cardMode: input.cardMode,
		cardFamilies: input.cardFamilies,
		implementerAgentId: input.implementerAgentId,
	});
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

export function normalizePanelReviewMode(value: unknown): PanelReviewMode | undefined {
	return isPanelReviewMode(value) ? value : undefined;
}

export function normalizePanelReviewRun(value: unknown): PanelReviewRun | undefined {
	const parsed = panelReviewRunSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}
