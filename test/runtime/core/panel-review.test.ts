import { describe, expect, it } from "vitest";

import {
	arePanelReviewFamiliesEqual,
	excludeImplementerFamily,
	panelReviewFamilyForAgentId,
	parsePanelReviewFamiliesInput,
	parsePanelReviewMode,
	resolveConfigPanelReviewFamilies,
	resolveEffectivePanelReview,
	sanitizePanelReviewFamilies,
} from "../../../src/core/panel-review";

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

describe("resolveEffectivePanelReview", () => {
	const allFamilies = ["grok", "claude", "gpt", "gemini"] as const;

	it("returns disabled when inherit and the workspace default is off", () => {
		expect(
			resolveEffectivePanelReview({
				card: {},
				config: { panelReviewEnabled: false, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "grok",
			}),
		).toEqual({ enabled: false, families: [] });
	});

	it("inherits workspace families and excludes the implementing family", () => {
		expect(
			resolveEffectivePanelReview({
				card: { panelReviewMode: "inherit" },
				config: { panelReviewEnabled: true, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "codex",
			}),
		).toEqual({ enabled: true, families: ["grok", "claude", "gemini"] });
	});

	it("excludes cline as the claude family", () => {
		expect(
			resolveEffectivePanelReview({
				card: {},
				config: { panelReviewEnabled: true, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "cline",
			}),
		).toEqual({ enabled: true, families: ["grok", "gpt", "gemini"] });
	});

	it("does not exclude unknown implementers", () => {
		expect(
			resolveEffectivePanelReview({
				card: {},
				config: { panelReviewEnabled: true, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "droid",
			}),
		).toEqual({ enabled: true, families: [...allFamilies] });
	});

	it("returns enabled-but-empty when inherit exclusion leaves no seats", () => {
		expect(
			resolveEffectivePanelReview({
				card: {},
				config: { panelReviewEnabled: true, panelReviewFamilies: ["gpt"] },
				implementerAgentId: "codex",
			}),
		).toEqual({ enabled: true, families: [] });
	});

	it("returns disabled when the card is off", () => {
		expect(
			resolveEffectivePanelReview({
				card: { panelReviewMode: "off" },
				config: { panelReviewEnabled: true, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "grok",
			}),
		).toEqual({ enabled: false, families: [] });
	});

	it("uses custom families without excluding the implementer", () => {
		expect(
			resolveEffectivePanelReview({
				card: { panelReviewMode: "custom", panelReviewFamilies: ["grok", "claude"] },
				config: { panelReviewEnabled: false, panelReviewFamilies: [...allFamilies] },
				implementerAgentId: "grok",
			}),
		).toEqual({ enabled: true, families: ["grok", "claude"] });
	});

	it("treats empty custom as enabled but empty", () => {
		expect(
			resolveEffectivePanelReview({
				card: { panelReviewMode: "custom", panelReviewFamilies: [] },
				config: { panelReviewEnabled: true, panelReviewFamilies: [...allFamilies] },
			}),
		).toEqual({ enabled: true, families: [] });
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
