import { describe, expect, it } from "vitest";

import {
	DEFAULT_PANEL_REVIEW_CONFIG,
	DEFAULT_PANEL_REVIEW_FAMILIES,
	implementerFamilyForAgent,
	isPanelReviewRunStale,
	type PanelReviewVerdict,
	panelReviewAllowsAutoReview,
	resolveEffectivePanelReview,
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
		expect(resolved).toEqual({ mode: "inherit", families: [], skipReason: "disabled" });
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
		expect(resolved).toEqual({ mode: "inherit", families: [], skipReason: "inherit-empty" });
	});

	it("uses custom families without excluding the implementer", () => {
		const resolved = resolveEffectivePanelReview({
			config: { panelReviewEnabled: true, panelReviewFamilies: DEFAULT_PANEL_REVIEW_FAMILIES },
			cardMode: "custom",
			cardFamilies: ["grok", "gpt"],
			implementerAgentId: "grok",
		});
		expect(resolved).toEqual({ mode: "custom", families: ["grok", "gpt"], skipReason: null });
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
