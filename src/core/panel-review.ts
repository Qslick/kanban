export const PANEL_REVIEW_FAMILIES = ["grok", "claude", "gpt", "gemini"] as const;
export type PanelReviewFamily = (typeof PANEL_REVIEW_FAMILIES)[number];

export const PANEL_REVIEW_MODES = ["inherit", "off", "custom"] as const;
export type PanelReviewMode = (typeof PANEL_REVIEW_MODES)[number];

export const PANEL_REVIEW_RUN_STATUSES = ["pending", "passed", "rejected", "split", "skipped"] as const;
export type PanelReviewRunStatus = (typeof PANEL_REVIEW_RUN_STATUSES)[number];

export const PANEL_REVIEW_VERDICTS = ["APPROVE", "APPROVE_WITH_CHANGES", "REJECT", "UNAVAILABLE", "BENCHED"] as const;
export type PanelReviewVerdict = (typeof PANEL_REVIEW_VERDICTS)[number];

export const DEFAULT_PANEL_REVIEW_ENABLED = false;
export const DEFAULT_PANEL_REVIEW_MODE: PanelReviewMode = "inherit";
export const DEFAULT_PANEL_REVIEW_FAMILIES: readonly PanelReviewFamily[] = PANEL_REVIEW_FAMILIES;

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

const PANEL_REVIEW_FAMILY_SET = new Set<string>(PANEL_REVIEW_FAMILIES);
const PANEL_REVIEW_MODE_SET = new Set<string>(PANEL_REVIEW_MODES);

export interface PanelReviewCardInput {
	panelReviewMode?: PanelReviewMode | null;
	panelReviewFamilies?: readonly PanelReviewFamily[] | null;
}

export interface PanelReviewConfigInput {
	panelReviewEnabled: boolean;
	panelReviewFamilies?: readonly PanelReviewFamily[] | null;
}

export interface EffectivePanelReview {
	/** True when a panel was requested. Families may still be empty after exclusion. */
	enabled: boolean;
	families: PanelReviewFamily[];
}

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

export function sanitizePanelReviewFamilies(families: readonly unknown[]): PanelReviewFamily[] {
	const present = new Set<PanelReviewFamily>();
	for (const family of families) {
		if (isPanelReviewFamily(family)) {
			present.add(family);
		}
	}
	return PANEL_REVIEW_FAMILIES.filter((family) => present.has(family));
}

export function resolveConfigPanelReviewFamilies(value: unknown): PanelReviewFamily[] {
	if (!Array.isArray(value)) {
		return [...DEFAULT_PANEL_REVIEW_FAMILIES];
	}
	const sanitized = sanitizePanelReviewFamilies(value);
	return sanitized.length > 0 ? sanitized : [...DEFAULT_PANEL_REVIEW_FAMILIES];
}

export function clonePanelReviewFamilies(
	families: readonly PanelReviewFamily[] | null | undefined,
): PanelReviewFamily[] | undefined {
	if (!families || families.length === 0) {
		return undefined;
	}
	const sanitized = sanitizePanelReviewFamilies(families);
	return sanitized.length > 0 ? sanitized : undefined;
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

/**
 * Map a Kanban agent id onto a panel-review family.
 * Unknown agents (opencode, droid, kiro, …) return null so inherit excludes nothing.
 */
export function panelReviewFamilyForAgentId(agentId: string | null | undefined): PanelReviewFamily | null {
	switch (agentId) {
		case "grok":
			return "grok";
		case "claude":
		case "cline":
			return "claude";
		case "codex":
			return "gpt";
		case "gemini":
			return "gemini";
		default:
			return null;
	}
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

/**
 * Resolve the seats that should run for one card.
 *
 * inherit + default off → disabled
 * inherit + default on → workspace families, minus the implementing family
 * off → disabled
 * custom → card families as written (no implementer exclusion)
 *
 * If inherit exclusion leaves zero seats, returns `{ enabled: true, families: [] }`.
 * Callers must not invent a replacement seat.
 */
export function resolveEffectivePanelReview(input: {
	card: PanelReviewCardInput;
	config: PanelReviewConfigInput;
	implementerAgentId?: string | null;
}): EffectivePanelReview {
	const mode = resolveTaskPanelReviewMode(input.card.panelReviewMode);

	if (mode === "off") {
		return { enabled: false, families: [] };
	}

	if (mode === "custom") {
		return {
			enabled: true,
			families: sanitizePanelReviewFamilies(input.card.panelReviewFamilies ?? []),
		};
	}

	if (!input.config.panelReviewEnabled) {
		return { enabled: false, families: [] };
	}

	const defaultFamilies = resolveConfigPanelReviewFamilies(input.config.panelReviewFamilies);
	return {
		enabled: true,
		families: excludeImplementerFamily(defaultFamilies, input.implementerAgentId),
	};
}
