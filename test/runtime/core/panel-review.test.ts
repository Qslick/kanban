import { describe, expect, it } from "vitest";

import {
	arePanelReviewFamiliesEqual,
	DEFAULT_PANEL_REVIEW_CONFIG,
	DEFAULT_PANEL_REVIEW_FAMILIES,
	excludeImplementerFamily,
	implementerFamilyForAgent,
	isPanelReviewRunStale,
	type PanelReviewVerdict,
	panelReviewAllowsAutoReview,
	panelReviewFamilyForAgentId,
	parsePanelReviewFamiliesInput,
	parsePanelReviewMode,
	resolveConfigPanelReviewFamilies,
	resolveEffectivePanelReview,
	sanitizePanelReviewFamilies,
	summarizePanelReviewRun,
} from "../../../src/core/panel-review";

function verdict(family: PanelReviewVerdict["family"], kind: PanelReviewVerdict["verdict"]): PanelReviewVerdict {
	return { family, verdict: kind };
}

describe("implementerFamilyForAgent", () => {
	it("maps each implementing agent onto its panel family", () => {
		expect(implementerFamilyForAgent("grok")).toBe("grok");
		expect(implementerFamilyForAgent("claude")).toBe("claude");
		expect(implementerFamilyForAgent("cline")).toBe("claude");
		expect(implementerFamilyForAgent("codex")).toBe("gpt");
		expect(implementerFamilyForAgent("gemini")).toBe("gemini");
		expect(implementerFamilyForAgent("opencode")).toBeNull();
		expect(implementerFamilyForAgent(null)).toBeNull();
	});
});

describe("resolveEffectivePanelReview", () => {
	it("skips when panel review is globally disabled", () => {
		const resolved = resolveEffectivePanelReview({
			config: DEFAULT_PANEL_REVIEW_CONFIG,
			implementerAgentId: "codex",
		});
		expect(resolved).toEqual({ mode: "inherit", families: [], skipReason: "disabled", enabled: false });
	});

	it("skips when the card turns panel review off", () => {
		const resolved = resolveEffectivePanelReview({
			config: { panelReviewEnabled: true, panelReviewFamilies: DEFAULT_PANEL_REVIEW_FAMILIES },
			cardMode: "off",
			implementerAgentId: "codex",
		});
		expect(resolved.skipReason).toBe("card-off");
		expect(resolved.families).toEqual([]);
	});

	it("excludes the implementing family on inherit", () => {
		const config = { panelReviewEnabled: true, panelReviewFamilies: DEFAULT_PANEL_REVIEW_FAMILIES };
		expect(resolveEffectivePanelReview({ config, implementerAgentId: "grok" }).families).toEqual([
			"claude",
			"gpt",
			"gemini",
		]);
		expect(resolveEffectivePanelReview({ config, implementerAgentId: "cline" }).families).toEqual([
			"grok",
			"gpt",
			"gemini",
		]);
		expect(resolveEffectivePanelReview({ config, implementerAgentId: "codex" }).families).toEqual([
			"grok",
			"claude",
			"gemini",
		]);
		expect(resolveEffectivePanelReview({ config, implementerAgentId: "gemini" }).families).toEqual([
			"grok",
			"claude",
			"gpt",
		]);
	});

	it("skips inherit when exclusion leaves no seats", () => {
		const resolved = resolveEffectivePanelReview({
			config: { panelReviewEnabled: true, panelReviewFamilies: ["gpt"] },
			implementerAgentId: "codex",
		});
		expect(resolved).toEqual({ mode: "inherit", families: [], skipReason: "inherit-empty", enabled: true });
	});

	it("uses custom families without excluding the implementer", () => {
		const resolved = resolveEffectivePanelReview({
			config: { panelReviewEnabled: true, panelReviewFamilies: DEFAULT_PANEL_REVIEW_FAMILIES },
			cardMode: "custom",
			cardFamilies: ["grok", "gpt"],
			implementerAgentId: "grok",
		});
		expect(resolved).toEqual({ mode: "custom", families: ["grok", "gpt"], skipReason: null, enabled: true });
	});
});

describe("summarizePanelReviewRun", () => {
	it("passes when every available seat approves", () => {
		const run = summarizePanelReviewRun({
			verdicts: [verdict("gpt", "APPROVE"), verdict("claude", "APPROVE_WITH_CHANGES")],
			recordedAt: 1,
			headCommit: "abc",
			selection: "inherit",
		});
		expect(run.status).toBe("passed");
	});

	it("rejects when a seat rejects and none approve", () => {
		const run = summarizePanelReviewRun({
			verdicts: [verdict("gpt", "REJECT"), verdict("claude", "UNAVAILABLE")],
			recordedAt: 1,
			headCommit: "abc",
			selection: "inherit",
		});
		expect(run.status).toBe("rejected");
	});

	it("splits when reject and approve both remain", () => {
		const run = summarizePanelReviewRun({
			verdicts: [verdict("gpt", "APPROVE"), verdict("claude", "REJECT")],
			recordedAt: 1,
			headCommit: "abc",
			selection: "inherit",
		});
		expect(run.status).toBe("split");
	});

	it("skips inherit when every seat is unavailable or benched", () => {
		const run = summarizePanelReviewRun({
			verdicts: [verdict("gpt", "UNAVAILABLE"), verdict("claude", "BENCHED")],
			recordedAt: 1,
			headCommit: "abc",
			selection: "inherit",
		});
		expect(run.status).toBe("skipped");
	});

	it("parks custom selection when every seat is unavailable", () => {
		const run = summarizePanelReviewRun({
			verdicts: [verdict("grok", "UNAVAILABLE")],
			recordedAt: 1,
			headCommit: "abc",
			selection: "custom",
		});
		expect(run.status).toBe("rejected");
		expect(run.note).toMatch(/unavailable/i);
	});
});

describe("panel review freshness and auto-review gate", () => {
	it("treats missing, pending, or HEAD-mismatched runs as stale", () => {
		expect(isPanelReviewRunStale(undefined, "abc")).toBe(true);
		expect(isPanelReviewRunStale({ status: "pending", verdicts: [], recordedAt: 1, headCommit: "abc" }, "abc")).toBe(
			true,
		);
		expect(isPanelReviewRunStale({ status: "passed", verdicts: [], recordedAt: 1, headCommit: "abc" }, "def")).toBe(
			true,
		);
		expect(isPanelReviewRunStale({ status: "passed", verdicts: [], recordedAt: 1, headCommit: "abc" }, "abc")).toBe(
			false,
		);
	});

	it("allows auto-review for skip reasons, passed runs, and inherit skips", () => {
		expect(panelReviewAllowsAutoReview({ skipReason: "disabled", run: undefined })).toBe(true);
		expect(panelReviewAllowsAutoReview({ skipReason: "inherit-empty", run: undefined })).toBe(true);
		expect(
			panelReviewAllowsAutoReview({
				skipReason: null,
				run: { status: "passed", verdicts: [], recordedAt: 1, headCommit: "abc" },
			}),
		).toBe(true);
		expect(
			panelReviewAllowsAutoReview({
				skipReason: null,
				run: { status: "skipped", verdicts: [], recordedAt: 1, headCommit: "abc" },
			}),
		).toBe(true);
		expect(
			panelReviewAllowsAutoReview({
				skipReason: null,
				run: { status: "rejected", verdicts: [], recordedAt: 1, headCommit: "abc" },
			}),
		).toBe(false);
		expect(
			panelReviewAllowsAutoReview({
				skipReason: null,
				run: { status: "split", verdicts: [], recordedAt: 1, headCommit: "abc" },
			}),
		).toBe(false);
	});
});

describe("panelReviewFamilyForAgentId", () => {
	it("maps known agents onto families", () => {
		expect(panelReviewFamilyForAgentId("grok")).toBe("grok");
		expect(panelReviewFamilyForAgentId("claude")).toBe("claude");
		expect(panelReviewFamilyForAgentId("cline")).toBe("claude");
		expect(panelReviewFamilyForAgentId("codex")).toBe("gpt");
		expect(panelReviewFamilyForAgentId("gemini")).toBe("gemini");
	});

	it("excludes nothing for unknown agents", () => {
		expect(panelReviewFamilyForAgentId("opencode")).toBeNull();
		expect(panelReviewFamilyForAgentId("droid")).toBeNull();
		expect(panelReviewFamilyForAgentId("kiro")).toBeNull();
		expect(panelReviewFamilyForAgentId(undefined)).toBeNull();
	});
});

describe("sanitizePanelReviewFamilies", () => {
	it("drops unknowns and canonicalizes order", () => {
		expect(sanitizePanelReviewFamilies(["gemini", "grok", "nope", "grok"])).toEqual(["grok", "gemini"]);
	});
});

describe("resolveEffectivePanelReview card/config shape", () => {
	const allFamilies = ["grok", "claude", "gpt", "gemini"] as const;

	it("returns disabled when inherit and the workspace default is off", () => {
		expect(
			resolveEffectivePanelReview({
				card: {},
				config: { panelReviewEnabled: false, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "grok",
			}),
		).toMatchObject({ enabled: false, families: [] });
	});

	it("inherits workspace families and excludes the implementing family", () => {
		expect(
			resolveEffectivePanelReview({
				card: { panelReviewMode: "inherit" },
				config: { panelReviewEnabled: true, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "codex",
			}),
		).toMatchObject({ enabled: true, families: ["grok", "claude", "gemini"] });
	});

	it("returns enabled-but-empty when inherit exclusion leaves no seats", () => {
		expect(
			resolveEffectivePanelReview({
				card: {},
				config: { panelReviewEnabled: true, panelReviewFamilies: ["gpt"] },
				implementerAgentId: "codex",
			}),
		).toMatchObject({ enabled: true, families: [] });
	});

	it("uses custom families without excluding the implementer", () => {
		expect(
			resolveEffectivePanelReview({
				card: { panelReviewMode: "custom", panelReviewFamilies: ["grok", "claude"] },
				config: { panelReviewEnabled: false, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "grok",
			}),
		).toMatchObject({ enabled: true, families: ["grok", "claude"] });
	});
});

describe("panel review parsers", () => {
	it("parses modes and family lists", () => {
		expect(parsePanelReviewMode("Custom")).toBe("custom");
		expect(parsePanelReviewFamiliesInput("gemini, grok,grok")).toEqual(["grok", "gemini"]);
		expect(resolveConfigPanelReviewFamilies(undefined)).toEqual(["grok", "claude", "gpt", "gemini"]);
		expect(arePanelReviewFamiliesEqual(["gemini", "grok"], ["grok", "gemini"])).toBe(true);
		expect(excludeImplementerFamily(["grok", "claude"], "claude")).toEqual(["grok"]);
	});

	it("rejects invalid parser input", () => {
		expect(() => parsePanelReviewMode("auto")).toThrow(/inherit, off, custom/);
		expect(() => parsePanelReviewFamiliesInput("grok,foo")).toThrow(/foo/);
		expect(() => parsePanelReviewFamiliesInput("  ,  ")).toThrow(/Expected one or more/);
	});
});
